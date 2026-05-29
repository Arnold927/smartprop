/**
 * logger.ts — Structured logger for SmartProp server.
 *
 * Zero external dependencies — uses Node's built-in console.
 * Production: emits JSON lines to stdout (compatible with Docker log drivers,
 *             Datadog, Loki, CloudWatch, etc.)
 * Development: emits colour-coded, human-readable lines.
 *
 * Usage (identical call-site API as before — no imports change):
 *   import { logger } from "./lib/logger";
 *   logger.info("Server started", { port: 5000 });
 *   logger.error("Payment failed", { tenantId: 123, err });
 *
 * Note: swap this back to pino after running `npm install` if you prefer.
 */

const IS_PROD = process.env.NODE_ENV === "production";

const LEVEL_ORDER: Record<string, number> = {
  debug: 10,
  info:  20,
  warn:  30,
  error: 40,
};

const LEVEL_COLOURS: Record<string, string> = {
  debug: "\x1b[36m", // cyan
  info:  "\x1b[32m", // green
  warn:  "\x1b[33m", // yellow
  error: "\x1b[31m", // red
};
const RESET = "\x1b[0m";

const configuredLevel = process.env.LOG_LEVEL ?? (IS_PROD ? "info" : "debug");
const configuredOrder = LEVEL_ORDER[configuredLevel] ?? 20;

function log(level: string, message: string, extra?: unknown): void {
  if ((LEVEL_ORDER[level] ?? 0) < configuredOrder) return;

  if (IS_PROD) {
    // Structured JSON — one line per log entry.
    const entry: Record<string, unknown> = {
      time:  new Date().toISOString(),
      level,
      msg:   message,
    };
    if (extra !== undefined) {
      if (extra instanceof Error) {
        entry.err = { message: extra.message, stack: extra.stack };
      } else if (typeof extra === "object" && extra !== null) {
        Object.assign(entry, extra);
      } else {
        entry.data = extra;
      }
    }
    process.stdout.write(JSON.stringify(entry) + "\n");
  } else {
    // Pretty dev output: HH:MM:ss LEVEL  message  {extra}
    const time   = new Date().toTimeString().slice(0, 8);
    const colour = LEVEL_COLOURS[level] ?? "";
    const tag    = `${colour}${level.toUpperCase().padEnd(5)}${RESET}`;
    const parts  = [`${time} ${tag} ${message}`];
    if (extra !== undefined) {
      parts.push(
        extra instanceof Error
          ? extra.stack ?? extra.message
          : JSON.stringify(extra, null, 2)
      );
    }
    const fn = level === "error" ? console.error
             : level === "warn"  ? console.warn
             : console.log;
    fn(parts.join(" "));
  }
}

export const logger = {
  debug: (msg: string, extra?: unknown) => log("debug", msg, extra),
  info:  (msg: string, extra?: unknown) => log("info",  msg, extra),
  warn:  (msg: string, extra?: unknown) => log("warn",  msg, extra),
  error: (msg: string, extra?: unknown) => log("error", msg, extra),
};