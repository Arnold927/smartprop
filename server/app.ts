/**
 * server/app.ts — Testable Express app factory
 *
 * Exports createApp() so integration tests can import the configured app
 * without starting the HTTP server or background schedulers.
 *
 * server/index.ts calls createApp() then attaches WebSocket and calls listen().
 * Test files call createApp() and pass the result to supertest().
 */

import express, { type Request, Response, NextFunction } from "express";
import cors          from "cors";
import cookieParser  from "cookie-parser";
import rateLimit     from "express-rate-limit";
import helmet        from "helmet";
// compression and morgan ship CJS-only typings with no default export;
// require() is the correct interop pattern when esModuleInterop doesn't help.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const compression: () => express.RequestHandler = require("compression");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const morgan: (format: string, options?: object) => express.RequestHandler = require("morgan");
import { registerModularRoutes } from "./routes/index";
import { logger } from "./lib/logger";

export async function createApp() {
  const app = express();

  const IS_PROD = process.env.NODE_ENV === "production";
  const IS_TEST = process.env.NODE_ENV === "test";

  // ── Trust proxy (required when behind Nginx/Caddy/load balancer) ─────────────
  if (IS_PROD) app.set("trust proxy", 1);

  // ── Security headers (Helmet) ─────────────────────────────────────────────────
  app.use(helmet({
    // Allow inline scripts/styles used by Vite-built frontend
    contentSecurityPolicy: IS_PROD ? {
      directives: {
        defaultSrc:     ["'self'"],
        scriptSrc:      ["'self'"],
        styleSrc:       ["'self'", "'unsafe-inline'"],
        imgSrc:         ["'self'", "data:", "blob:", "https:"],
        connectSrc:     ["'self'", "https://api.resend.com", "https://api.safaricom.co.ke",
                         "https://sandbox.safaricom.co.ke", "https://api.twilio.com"],
        fontSrc:        ["'self'", "data:"],
        objectSrc:      ["'none'"],
        upgradeInsecureRequests: IS_PROD ? [] : null,
      },
    } : false,
    crossOriginEmbedderPolicy: false,   // needed for some browser APIs
  }));

  // ── HTTP compression (gzip/brotli) ───────────────────────────────────────────
  app.use(compression());

  // ── Request logging (Morgan) ─────────────────────────────────────────────────
  if (!IS_TEST) {
    // Production: Apache combined format to stdout (works with Docker log drivers)
    // Development: concise dev format with colours
    app.use(morgan(IS_PROD ? "combined" : "dev", {
      stream: {
        write: (msg: string) => logger.info(msg.trim()),
      },
    }));
  }

  // ── CORS ─────────────────────────────────────────────────────────────────────
  const allowedOrigins = (
    process.env.ALLOWED_ORIGINS || "http://localhost:5173,http://localhost:5174"
  ).split(",").map(o => o.trim());

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin) || !IS_PROD) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }));
  app.options("*", cors());

  // ── Body parsers ──────────────────────────────────────────────────────────────
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: false, limit: "10mb" }));
  app.use(cookieParser());

  // ── Rate limiting ─────────────────────────────────────────────────────────────
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: IS_TEST ? 10_000 : 20,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => IS_TEST,
    message: { message: "Too many login attempts. Please try again in 15 minutes." },
  });

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: IS_TEST ? 10_000 : 300,
    skip: () => IS_TEST || !IS_PROD,
    message: { message: "Too many requests. Please slow down." },
  });

  app.use("/api/auth/login",           authLimiter);
  app.use("/api/auth/signup",          authLimiter);
  app.use("/api/auth/forgot-password", authLimiter);
  app.use("/api/auth/refresh",         authLimiter);
  app.use("/api",                      apiLimiter);

  // ── Health ────────────────────────────────────────────────────────────────────
  app.get("/api/health", (_req, res) =>
    res.json({ status: "ok", timestamp: new Date().toISOString(), env: process.env.NODE_ENV })
  );

  // ── Routes ────────────────────────────────────────────────────────────────────
  registerModularRoutes(app);

  // ── Global error handler ──────────────────────────────────────────────────────
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status  = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    // Log 5xx errors — these are our bugs, not client errors
    if (status >= 500) {
      logger.error("Unhandled server error", {
        status,
        message,
        stack: IS_PROD ? undefined : err.stack,
      });
    }

    res.status(status).json({ message });
  });

  return app;
}