import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";

const viteLogger = createLogger();

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function setupVite(app: Express, server: Server) {
  const viteConfig = await import("../client/vite.config");

  const vite = await createViteServer({
    ...(viteConfig.default as any), // cast to any to resolve dual-Vite type conflict
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
      },
    },
    server: {
      middlewareMode: true,
      hmr: { server },
      allowedHosts: true as const,
    },
    appType: "custom",
  });

  app.use(vite.middlewares);

  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path.resolve(
        path.dirname(new URL(import.meta.url).pathname),
        "..",
        "client",
        "index.html"
      );
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  // Built frontend lands in dist/public (from client/vite.config.ts build.outDir)
  const distPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
    "dist",
    "public"
  );

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Frontend build not found at: ${distPath}\nRun "npm run build:client" first.`
    );
  }

  app.use(express.static(distPath, { maxAge: "1y", etag: true }));

  // SPA fallback - all non-API routes serve index.html
  app.use("*", (req, res, next) => {
    if (req.originalUrl.startsWith("/api")) return next();
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}