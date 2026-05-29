// Keep this import first — Sentry must load before all other modules
import "./instrument";
import { Sentry } from "./instrument";

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { registerModularRoutes } from "./routes/index";

import { ensureIpnRegistered } from "./services/pesapal.js";
import { 
initWebSocketServer, closeWebSocketServer } from "./ws";
import { startRentScheduler } from "./services/rentScheduler";
import { startMpesaSweep }   from "./services/mpesaSweep";
import { startLeaseScheduler } from "./services/leaseScheduler";
import { startReportScheduler } from "./services/reportScheduler";
import { runRegulatoryCertsMigration } from "./services/regulatory-certs-migration";
import { createServer } from "http";
import { log, serveStatic } from "./vite";
import { logger } from "./lib/logger";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

// Validate required env vars at startup
const REQUIRED_ENV = ["DATABASE_URL", "JWT_SECRET", "JWT_REFRESH_SECRET"];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    logger.error(`FATAL: Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const app = express();

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = (
  process.env.ALLOWED_ORIGINS || "http://localhost:5173,http://localhost:5174"
)
  .split(",")
  .map((o) => o.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // native apps / curl
      if (
        allowedOrigins.includes(origin) ||
        process.env.NODE_ENV === "development"
      ) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.options("*", cors());

// ── Body parsers ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: false, limit: "10mb" }));
app.use(cookieParser());

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Strict limit on auth endpoints to block brute-force attacks
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { message: "Too many requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// General API limit (generous — just protects against abuse)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 300,
  message: { message: "Too many requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV === "development",
});

app.use("/api/auth/login", authLimiter);
app.use("/api/auth/signup", authLimiter);
app.use("/api/auth/forgot-password", authLimiter);
app.use("/api/auth/refresh", authLimiter);
app.use("/api", apiLimiter);

// ── Request logging ───────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  const reqPath = req.path;
  let capturedJson: Record<string, any> | undefined;

  const origJson = res.json.bind(res);
  res.json = function (body: any) {
    capturedJson = body;
    return origJson(body);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (reqPath.startsWith("/api")) {
      let line = `${req.method} ${reqPath} ${res.statusCode} in ${duration}ms`;
      if (capturedJson && res.statusCode >= 400) {
        line += ` :: ${JSON.stringify(capturedJson)}`;
      }
      if (line.length > 120) line = line.slice(0, 119) + "…";
      log(line);
    }
  });

  next();
});

// ── Static uploads (dev fallback only) ────────────────────────────────────────
// In production, files are stored in S3/R2 and served directly from the bucket
// URL returned by resolveUploadUrl().  This route only handles the local-disk
// fallback that s3Upload uses when S3_* env vars are absent (i.e. local dev).
// It is harmless in production but serves nothing — all URLs will point to S3.
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// ── Routes ────────────────────────────────────────────────────────────────────
(async () => {
  try {
    registerModularRoutes(app);

  // Sentry error handler — must be registered after all routes
  Sentry.setupExpressErrorHandler(app);

    // ── Pesapal IPN registration ──────────────────────────────────────────────
    // Register our webhook URL with Pesapal once at startup so IPN callbacks
    // are delivered to /api/billing/webhook.  Only runs when credentials are set.
    if (process.env.PESAPAL_CONSUMER_KEY && process.env.PESAPAL_IPN_URL) {
      ensureIpnRegistered()
        .then((ipnId) => log(`Pesapal IPN registered: ${ipnId}`))
        .catch((err) => log(`Pesapal IPN registration skipped: ${err.message}`));
    }

    // ── Global error handler ──────────────────────────────────────────────────
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      if (status >= 500) log(`Error: ${message}`);
      res.status(status).json({ message });
    });

    // ── Static frontend (production only) ─────────────────────────────────────
    if (app.get("env") !== "development") {
      serveStatic(app);
    } else {
      log("Development mode: frontend served by Vite on port 5173");
    }

    const port = parseInt(process.env.PORT || "5000", 10);
    const httpServer = createServer(app);

    // Initialise WebSocket server on the same HTTP server (path /ws)
    initWebSocketServer(httpServer);

    // ── Pending table migrations ───────────────────────────────────────────────
    await runRegulatoryCertsMigration();

    // ── Rent scheduler ────────────────────────────────────────────────────────
    startRentScheduler();

    // ── M-Pesa pending transaction sweep (every 5 min) ───────────────────────
    startMpesaSweep();

    // ── Lease lifecycle scheduler (expiry notices, auto-expire) ───────────────
    startLeaseScheduler();

    // ── Monthly owner statement email scheduler ────────────────────────────────
    startReportScheduler();

    httpServer.listen(port, "0.0.0.0", () => {
      log(`Server running on port ${port} [${app.get("env")}]`);
    });

    // Graceful shutdown
    process.on("SIGTERM", () => {
      log("SIGTERM received — shutting down gracefully");
      closeWebSocketServer();
      httpServer.close(() => process.exit(0));
    });
  } catch (err) {
    logger.error("Failed to start server:", err);
    process.exit(1);
  }
})();