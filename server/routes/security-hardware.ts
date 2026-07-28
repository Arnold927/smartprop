/**
 * security-hardware.ts — mounted at /api/security/hardware-event
 *
 * Generic webhook receiver for physical security hardware.
 * Translates device-specific payloads from Hikvision and ZKTeco
 * into a normalised internal event, then writes to vehicle_movement_log
 * and/or visitors (gate pass auto-log).
 *
 * INTEGRATION IS OPTIONAL — properties without hardware work exactly
 * as before. Hardware must be configured per-property in siteSettings:
 *   properties.siteSettings.hardwareIntegration = {
 *     enabled: true,
 *     webhookSecret: "<hmac-secret>",       // shared secret for HMAC-SHA256 verification
 *     vendor: "hikvision" | "zkteco" | "generic",
 *     deviceLabel: "Main Gate Camera",
 *   }
 *
 * ── Endpoints ──────────────────────────────────────────────────────────
 *
 * POST /api/security/hardware-event
 *   Public endpoint (no JWT) — authenticated via HMAC-SHA256 signature
 *   in the X-Webhook-Signature header (format: sha256=<hex>).
 *   Body: vendor-specific JSON payload.
 *
 * POST /api/security/hardware-event/test
 *   Auth-protected test endpoint — lets PMs fire a synthetic event
 *   to verify their webhook pipeline.
 *
 * GET  /api/security/hardware-config/:propertyId
 *   Auth-protected — return current hardware config (secret redacted).
 *
 * PUT  /api/security/hardware-config/:propertyId
 *   Auth-protected — save/update hardware config.
 *
 * ── Normalised event shape ───────────────────────────────────────────
 * {
 *   eventType: "vehicle_entry" | "vehicle_exit" | "intercom_open" | "access_denied" | "unknown"
 *   plateNumber?: string          (from ANPR camera)
 *   vehicleType?: string
 *   deviceId?: string             (camera / reader ID)
 *   deviceLabel?: string
 *   accessCardId?: string         (ZKTeco card UID)
 *   personName?: string
 *   timestamp: string             (ISO 8601)
 *   rawPayload: object            (stored for audit)
 * }
 */

import crypto  from "crypto";
import { Router } from "express";
import { db }     from "../db";
import { properties, vehicleMovementLog, visitors } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg }      from "../middleware/requireOrg";
import { authenticateGuard } from "./gate-pins";

export const securityHardwareRouter = Router();

// authAdmin: full admin/manager JWT required (e.g. test-fire endpoint)
const authAdmin = [authenticateJWT as any, requireOrg as any];
// authGuardOrAdmin: accepts both guard tokens and admin JWTs — used for config
// endpoints that guards access from the Hardware tab
const authGuardOrAdmin = [authenticateGuard as any];

// ── Normalised event type ─────────────────────────────────────────────────────

type EventType = "vehicle_entry" | "vehicle_exit" | "intercom_open" | "access_denied" | "unknown";

interface NormalisedEvent {
  eventType:    EventType;
  plateNumber?: string;
  vehicleType?: string;
  deviceId?:    string;
  deviceLabel?: string;
  accessCardId?: string;
  personName?:  string;
  timestamp:    string;
  rawPayload:   Record<string, any>;
}

// ── Adapters ──────────────────────────────────────────────────────────────────

/**
 * Hikvision ISAPI / Hik-Connect webhook normaliser.
 * Hikvision sends events as XML or JSON depending on firmware version.
 * We handle the JSON form (ISAPI 2.0+).
 *
 * Key fields:
 *   ipms/events/EventNotification/eventType — "ANPR" | "AccessControl" | "VideoMotion"
 *   ipms/events/EventNotification/ANPR/licensePlate — plate string
 *   ipms/events/EventNotification/AccessControllerEvent/cardReaderNo
 *   ipms/events/EventNotification/AccessControllerEvent/cardNo
 */
function adaptHikvision(body: any): NormalisedEvent {
  const ev   = body?.ipms?.events?.EventNotification ?? body?.EventNotification ?? body;
  const type = (ev?.eventType ?? ev?.EventType ?? "").toUpperCase();
  const ts   = ev?.dateTime ?? new Date().toISOString();

  // ANPR (Automatic Number Plate Recognition) event
  if (type === "ANPR" || ev?.ANPR) {
    const anpr  = ev?.ANPR ?? {};
    const plate = anpr?.licensePlate ?? anpr?.plateNumber ?? "";
    const dir   = (anpr?.direction ?? "").toLowerCase();
    return {
      eventType:   dir === "exit" ? "vehicle_exit" : "vehicle_entry",
      plateNumber: plate.toUpperCase().replace(/\s+/g, ""),
      vehicleType: anpr?.vehicleType?.toLowerCase() ?? "car",
      deviceId:    ev?.channelID ?? ev?.deviceID,
      deviceLabel: ev?.channelName ?? "Hikvision Camera",
      timestamp:   ts,
      rawPayload:  body,
    };
  }

  // Access control event (intercom / card reader)
  if (type === "ACCESSCONTROL" || ev?.AccessControllerEvent) {
    const ace  = ev?.AccessControllerEvent ?? {};
    const event = (ace?.subEventType ?? "").toLowerCase();
    return {
      eventType:    event.includes("deny") ? "access_denied" : "intercom_open",
      accessCardId: ace?.cardNo,
      personName:   ace?.name,
      deviceId:     String(ace?.cardReaderNo ?? ""),
      deviceLabel:  "Hikvision Access Controller",
      timestamp:    ts,
      rawPayload:   body,
    };
  }

  return { eventType: "unknown", timestamp: ts, rawPayload: body };
}

/**
 * ZKTeco BioSecurity / ZKBio Access webhook normaliser.
 * ZKTeco sends JSON with transaction records.
 *
 * Key fields:
 *   transaction/event_type  — "0" check-in, "1" check-out, "4" break out
 *   transaction/card_no     — card UID
 *   transaction/user_id     — employee/resident ID
 *   transaction/time        — "2024-01-15 09:30:00"
 *   transaction/dev_id      — device serial
 */
function adaptZKTeco(body: any): NormalisedEvent {
  const tx  = body?.transaction ?? body?.Transaction ?? body;
  const ts  = tx?.time ? new Date(tx.time).toISOString() : new Date().toISOString();
  const evType = String(tx?.event_type ?? tx?.eventType ?? "0");

  // ZKTeco vehicle ANPR (some models)
  if (tx?.plate_number || tx?.plateNumber) {
    const plate = (tx.plate_number ?? tx.plateNumber ?? "").toUpperCase();
    const dir   = evType === "1" ? "vehicle_exit" : "vehicle_entry";
    return {
      eventType:   dir,
      plateNumber: plate.replace(/\s+/g, ""),
      vehicleType: "car",
      deviceId:    tx?.dev_id,
      deviceLabel: "ZKTeco ANPR",
      timestamp:   ts,
      rawPayload:  body,
    };
  }

  // Standard card/fingerprint access event
  const isExit  = ["1", "4", "5"].includes(evType); // checkout / break-out / overtime-out
  const isDenied = ["3", "6"].includes(evType);       // denied / anti-passback

  return {
    eventType:    isDenied ? "access_denied" : isExit ? "intercom_open" : "intercom_open",
    accessCardId: tx?.card_no ?? tx?.cardNo,
    personName:   tx?.user_name ?? tx?.userName,
    deviceId:     tx?.dev_id,
    deviceLabel:  "ZKTeco Reader",
    timestamp:    ts,
    rawPayload:   body,
  };
}

/**
 * Generic / catch-all normaliser.
 * Expects a pre-normalised payload (callers that already handle
 * vendor-specific translation and just want to fire an event).
 */
function adaptGeneric(body: any): NormalisedEvent {
  return {
    eventType:    (body?.eventType as EventType) ?? "unknown",
    plateNumber:  body?.plateNumber?.toUpperCase?.() ?? body?.plate,
    vehicleType:  body?.vehicleType ?? "car",
    deviceId:     body?.deviceId,
    deviceLabel:  body?.deviceLabel,
    accessCardId: body?.accessCardId,
    personName:   body?.personName,
    timestamp:    body?.timestamp ?? new Date().toISOString(),
    rawPayload:   body,
  };
}

// ── HMAC verification ─────────────────────────────────────────────────────────

function verifySignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  // Constant-time compare to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signatureHeader, "utf8"),
      Buffer.from(expected, "utf8"),
    );
  } catch {
    return false;
  }
}

// ── Persist normalised event ──────────────────────────────────────────────────

async function persistEvent(event: NormalisedEvent, propertyId: number): Promise<void> {
  if (event.eventType === "vehicle_entry" || event.eventType === "vehicle_exit") {
    if (event.plateNumber) {
      await db.insert(vehicleMovementLog).values({
        propertyId,
        plateNumber: event.plateNumber,
        vehicleType: event.vehicleType ?? "car",
        direction:   event.eventType === "vehicle_entry" ? "in" : "out",
        purpose:     "hardware_event",
        driverName:  event.personName ?? null,
        notes:       `Auto-logged via ${event.deviceLabel ?? "security hardware"} · Device: ${event.deviceId ?? "unknown"}`,
        loggedBy:    event.deviceLabel ?? "Hardware Integration",
      } as any);
    }
  }
  // intercom_open / access_denied — logged only to console for now
  // (could extend to push a notification or increment a counter)
}

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/security/hardware-event
// Public — authenticated by HMAC-SHA256 signature
// Query param: ?propertyId=<id>&vendor=hikvision|zkteco|generic
// ══════════════════════════════════════════════════════════════════════════════
securityHardwareRouter.post(
  "/hardware-event",
  // Need raw body for HMAC — use express.raw() middleware upstream if possible.
  // Express JSON body parser runs before this; we work around it by re-computing
  // the hash from the parsed body when rawBody is unavailable.
  async (req: any, res: any) => {
    try {
      const propertyId = parseInt(req.query.propertyId as string);
      const vendor     = (req.query.vendor as string ?? "generic").toLowerCase();

      if (isNaN(propertyId)) {
        return res.status(400).json({ message: "propertyId query param required" });
      }

      // Fetch property + hardware config
      const [prop] = await db
        .select({ id: properties.id, siteSettings: properties.siteSettings })
        .from(properties)
        .where(eq(properties.id, propertyId))
        .limit(1);

      if (!prop) {
        return res.status(404).json({ message: "Property not found" });
      }

      const hw = (prop.siteSettings as any)?.hardwareIntegration;

      // If hardware integration is not configured for this property, reject.
      if (!hw?.enabled) {
        return res.status(403).json({
          message: "Hardware integration is not enabled for this property. Configure it in property settings first.",
        });
      }

      // Verify HMAC signature when a secret is configured.
      if (!hw.webhookSecret) {
        // Should no longer be reachable for newly-saved configs (the PUT
        // handler now requires a secret whenever enabled=true), but kept as
        // a defensive rejection for any pre-existing config saved before
        // that requirement existed — previously this silently skipped
        // verification entirely and accepted the event unauthenticated.
        console.warn(`[HardwareEvent] property #${propertyId} is enabled with no webhook secret configured — rejecting`);
        return res.status(403).json({ message: "Hardware integration is enabled but no webhook secret is configured. Set one in property settings." });
      }

      const sigHeader = req.headers["x-webhook-signature"] as string | undefined;
      const rawBody   = (req as any).rawBody instanceof Buffer
        ? (req as any).rawBody
        : Buffer.from(JSON.stringify(req.body));
      const valid     = verifySignature(rawBody, sigHeader, hw.webhookSecret);
      if (!valid) {
        console.warn(`[HardwareEvent] HMAC verification failed for property #${propertyId}`);
        return res.status(401).json({ message: "Invalid webhook signature" });
      }

      // Adapt payload to normalised event
      const effectiveVendor = hw.vendor ?? vendor;
      let event: NormalisedEvent;
      if (effectiveVendor === "hikvision") {
        event = adaptHikvision(req.body);
      } else if (effectiveVendor === "zkteco") {
        event = adaptZKTeco(req.body);
      } else {
        event = adaptGeneric(req.body);
      }

      // Persist
      await persistEvent(event, propertyId);

      console.log(`[HardwareEvent] property=${propertyId} vendor=${effectiveVendor} event=${event.eventType} plate=${event.plateNumber ?? "—"}`);

      res.status(200).json({
        received:  true,
        eventType: event.eventType,
        plateNumber: event.plateNumber,
        timestamp:   event.timestamp,
      });
    } catch (err: any) {
      console.error("[HardwareEvent] error:", err);
      res.status(500).json({ message: "Failed to process hardware event" });
    }
  },
);

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/security/hardware-event/test
// Auth-protected — fires a synthetic vehicle-entry event for testing
// ══════════════════════════════════════════════════════════════════════════════
securityHardwareRouter.post("/hardware-event/test", ...authAdmin, async (req: any, res: any) => {
  try {
    const orgId:      number = req.user.organizationId;
    const propertyId: number = parseInt(req.body.propertyId);
    const plate:      string = (req.body.plateNumber ?? "TEST 001").toUpperCase();
    const direction:  string = req.body.direction ?? "in";

    if (isNaN(propertyId)) {
      return res.status(400).json({ message: "propertyId required" });
    }

    // Verify property belongs to org
    const [prop] = await db
      .select({ id: properties.id })
      .from(properties)
      .where(and(eq(properties.id, propertyId), eq(properties.organizationId, orgId)))
      .limit(1);

    if (!prop) return res.status(404).json({ message: "Property not found" });

    await db.insert(vehicleMovementLog).values({
      propertyId,
      plateNumber: plate,
      vehicleType: "car",
      direction:   direction === "out" ? "out" : "in",
      purpose:     "test_event",
      notes:       "Synthetic test event via hardware integration test endpoint",
      loggedBy:    "Hardware Integration Test",
    } as any);

    res.json({ success: true, message: `Test vehicle-${direction} event logged for plate ${plate}` });
  } catch (err: any) {
    console.error("[HardwareEvent] test error:", err);
    res.status(500).json({ message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /api/security/hardware-config/:propertyId
// Returns current hardware config (secret masked)
// ══════════════════════════════════════════════════════════════════════════════
securityHardwareRouter.get("/hardware-config/:propertyId", ...authGuardOrAdmin, async (req: any, res: any) => {
  try {
    const orgId:      number = req.user.organizationId;
    const propertyId: number = parseInt(req.params.propertyId);

    // Guards may only query their own assigned property
    if (req.user.role === "guard" && req.user.propertyId !== propertyId) {
      return res.status(403).json({ message: "Guards may only view config for their assigned property" });
    }

    const [prop] = await db
      .select({ siteSettings: properties.siteSettings })
      .from(properties)
      .where(and(eq(properties.id, propertyId), eq(properties.organizationId, orgId)))
      .limit(1);

    if (!prop) return res.status(404).json({ message: "Property not found" });

    const hw = (prop.siteSettings as any)?.hardwareIntegration ?? null;

    // Mask the secret
    const masked = hw ? {
      ...hw,
      webhookSecret: hw.webhookSecret ? `${hw.webhookSecret.slice(0, 4)}${"•".repeat(12)}` : null,
    } : null;

    res.json({
      configured: !!hw?.enabled,
      config:     masked,
      webhookUrl: `/api/security/hardware-event?propertyId=${propertyId}&vendor=${hw?.vendor ?? "generic"}`,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// PUT /api/security/hardware-config/:propertyId
// Body: { enabled, vendor, deviceLabel, webhookSecret?, notes? }
// ══════════════════════════════════════════════════════════════════════════════
securityHardwareRouter.put("/hardware-config/:propertyId", ...authGuardOrAdmin, async (req: any, res: any) => {
  try {
    const orgId:      number = req.user.organizationId;
    const propertyId: number = parseInt(req.params.propertyId);

    // Guards cannot modify hardware configuration — read-only access
    if (req.user.role === "guard") {
      return res.status(403).json({ message: "Guards cannot modify hardware configuration. Contact your property manager." });
    }

    const [prop] = await db
      .select({ id: properties.id, siteSettings: properties.siteSettings })
      .from(properties)
      .where(and(eq(properties.id, propertyId), eq(properties.organizationId, orgId)))
      .limit(1);

    if (!prop) return res.status(404).json({ message: "Property not found" });

    const { enabled, vendor, deviceLabel, webhookSecret, notes } = req.body;

    const currentSettings = (prop.siteSettings as any) ?? {};
    const existingHw      = currentSettings.hardwareIntegration ?? {};

    const resolvedSecret = webhookSecret?.trim()
      ? webhookSecret.trim()
      : existingHw.webhookSecret ?? null;

    // The webhook endpoint (POST /hardware-event) skips signature
    // verification entirely whenever no secret is configured — an
    // enabled-but-secret-less property would accept unauthenticated events
    // from anyone who could guess its numeric id. Require one whenever
    // integration is being enabled, rather than allowing that combination.
    if (Boolean(enabled) && !resolvedSecret) {
      return res.status(400).json({ message: "A webhook secret is required to enable hardware integration." });
    }

    const updatedHw = {
      ...existingHw,
      enabled:       Boolean(enabled),
      vendor:        vendor ?? existingHw.vendor ?? "generic",
      deviceLabel:   deviceLabel ?? existingHw.deviceLabel ?? "",
      notes:         notes ?? existingHw.notes ?? "",
      webhookSecret: resolvedSecret,
    };

    await db
      .update(properties)
      .set({
        siteSettings: { ...currentSettings, hardwareIntegration: updatedHw },
        updatedAt:    new Date(),
      })
      .where(eq(properties.id, propertyId));

    // Return masked config
    res.json({
      success: true,
      config: {
        ...updatedHw,
        webhookSecret: updatedHw.webhookSecret ? `${updatedHw.webhookSecret.slice(0, 4)}${"•".repeat(12)}` : null,
      },
      webhookUrl: `/api/security/hardware-event?propertyId=${propertyId}&vendor=${updatedHw.vendor}`,
    });
  } catch (err: any) {
    console.error("[HardwareConfig] PUT error:", err);
    res.status(500).json({ message: err.message });
  }
});