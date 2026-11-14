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

  // Caching rules (this matters: a stale index.html points at JS files that a newer deploy has removed):
  //   /assets/*  → hashed file names, never change → cache for a year
  //   everything else (index.html, sw.js, manifest, icons) → always revalidate
  app.use(express.static(distPath, {
    etag: true,
    setHeaders: (res, filePath) => {
      const inAssets = filePath.includes(`${path.sep}assets${path.sep}`);
      res.setHeader("Cache-Control", inAssets ? "public, max-age=31536000, immutable" : "no-cache");
    },
  }));

  // A missing file must be a real 404. Answering with index.html (the SPA page) makes the browser try to run
  // HTML as JavaScript, which surfaces as "Failed to fetch dynamically imported module" and can't be told apart
  // from a network problem. A 404 lets the app detect a stale build and reload itself.
  const FILE_EXT = /\.(js|mjs|css|map|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|json|txt|mp4|webm|pdf)$/i;
  app.use("/assets", (_req, res) => {
    res.status(404).set("Cache-Control", "no-store").type("text/plain").send("Not found");
  });

  // SPA fallback - all other non-API routes serve index.html (never cached)
  app.use("*", (req, res, next) => {
    if (req.originalUrl.startsWith("/api")) return next();
    if (FILE_EXT.test(req.originalUrl.split("?")[0])) return res.status(404).set("Cache-Control", "no-store").type("text/plain").send("Not found");
    res.set("Cache-Control", "no-cache");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}