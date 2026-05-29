/**
 * instrument.ts — Sentry initialisation for SmartProp server.
 *
 * MUST be imported before any other module in server/index.ts so that
 * Sentry can instrument Express, the DB client, and async contexts.
 *
 * Required env vars:
 *   SENTRY_DSN  — your project DSN from sentry.io (omit to disable)
 *   NODE_ENV    — "production" activates full error + performance tracking
 */

import * as Sentry from "@sentry/node";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    release: process.env.APP_VERSION,          // set in Dockerfile or CI

    // Capture 100% of transactions in prod; tune down if volume is high
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1.0,

    // Capture 100% of errors always
    sampleRate: 1.0,

    // Scrub sensitive fields from payloads before they leave the server
    beforeSend(event) {
      if (event.request?.data) {
        const data = event.request.data as Record<string, unknown>;
        for (const key of ["password", "passwordHash", "token", "secret", "cardNumber"]) {
          if (key in data) data[key] = "[Filtered]";
        }
      }
      return event;
    },
  });

  console.info(`[Sentry] Initialised — env=${process.env.NODE_ENV}, dsn=...${dsn.slice(-6)}`);
} else {
  console.warn("[Sentry] SENTRY_DSN not set — error tracking disabled");
}

export { Sentry };
