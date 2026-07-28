/**
 * Gate PIN Routes
 *
 * Admin routes (require full JWT auth):
 *   GET    /api/gate-pins?propertyId=X       — list PINs for a property
 *   POST   /api/gate-pins                    — create a new PIN
 *   PATCH  /api/gate-pins/:id/toggle         — activate / deactivate
 *   DELETE /api/gate-pins/:id                — delete a PIN
 *
 * Public guard auth (no JWT required):
 *   POST   /api/gate-auth/login              — validate PIN → return short-lived guard token
 *   GET    /api/gate-auth/verify             — verify a guard token (used by frontend on load)
 */

import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { db } from "../db";
import { gatePins, properties, guardShifts } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import { whatsappService } from "../whatsapp";

const adminRouter = Router();
const authRouter  = Router();

const auth = [authenticateJWT as any, requireOrg as any];

const JWT_SECRET        = process.env.JWT_SECRET || "fallback-dev-secret-change-in-production";
const GUARD_TOKEN_TTL   = 60 * 60 * 12; // 12-hour sessions (one shift)
const BCRYPT_ROUNDS     = 10;

// ── Helpers ────────────────────────────────────────────────────────────────────

function sanitizePin(row: any) {
  return {
    id:         row.id,
    propertyId: row.propertyId,
    label:      row.label,
    isActive:   row.isActive,
    expiresAt:  row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    createdAt:  row.createdAt,
    // Never return pinHash
  };
}

/** Verifies the caller may manage guard PINs for this property: any
 *  property in the org for admin/manager, but only properties a landlord
 *  actually owns — matching the same ownership pattern used for
 *  caretakers.ts, since a self-managing landlord with no management
 *  company needs to be able to create/disable their own gate PINs without
 *  seeing or touching any other landlord's properties. */
async function canManagePinsFor(propertyId: number, orgId: number, role: string, userId: string): Promise<boolean> {
  const condition = role === "landlord"
    ? and(eq(properties.id, propertyId), eq(properties.organizationId, orgId), eq(properties.ownerId, userId))
    : and(eq(properties.id, propertyId), eq(properties.organizationId, orgId));
  const [prop] = await db.select({ id: properties.id }).from(properties).where(condition).limit(1);
  return !!prop;
}

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN: GET /api/gate-pins?propertyId=X
// ══════════════════════════════════════════════════════════════════════════════
adminRouter.get("/", ...auth, async (req: any, res: any) => {
  try {
    const orgId      = req.user.organizationId as number;
    const role       = req.user.role as string;
    const propertyId = parseInt(req.query.propertyId as string);

    if (!propertyId) {
      return res.status(400).json({ message: "propertyId is required" });
    }

    if (!(await canManagePinsFor(propertyId, orgId, role, req.user.id))) {
      return res.status(404).json({ message: "Property not found" });
    }

    const pins = await db
      .select()
      .from(gatePins)
      .where(eq(gatePins.propertyId, propertyId))
      .orderBy(desc(gatePins.createdAt));

    return res.json(pins.map(sanitizePin));
  } catch (err) {
    console.error("GET /api/gate-pins error:", err);
    return res.status(500).json({ message: "Failed to fetch gate PINs" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN: POST /api/gate-pins
// Body: { propertyId, label, pin, expiresAt? }
// ══════════════════════════════════════════════════════════════════════════════
adminRouter.post("/", ...auth, async (req: any, res: any) => {
  try {
    const orgId    = req.user.organizationId as number;
    const role     = req.user.role as string;
    const userId   = req.user.id as string;
    const { propertyId, label, pin, expiresAt, guardPhone } = req.body;

    if (!propertyId)        return res.status(400).json({ message: "propertyId is required" });
    if (!label?.trim())     return res.status(400).json({ message: "label is required" });
    if (!pin)               return res.status(400).json({ message: "pin is required" });
    if (pin.length < 4)     return res.status(400).json({ message: "PIN must be at least 4 digits" });
    if (pin.length > 8)     return res.status(400).json({ message: "PIN must be at most 8 digits" });
    if (!/^\d+$/.test(pin)) return res.status(400).json({ message: "PIN must contain digits only" });

    // Verify property belongs to org — and, for a self-managing landlord,
    // that they specifically own it.
    const propCondition = role === "landlord"
      ? and(eq(properties.id, parseInt(propertyId)), eq(properties.organizationId, orgId), eq(properties.ownerId, userId))
      : and(eq(properties.id, parseInt(propertyId)), eq(properties.organizationId, orgId));
    const [prop] = await db
      .select({ id: properties.id, name: properties.name })
      .from(properties)
      .where(propCondition)
      .limit(1);

    if (!prop) return res.status(404).json({ message: "Property not found" });

    const pinHash = await bcrypt.hash(pin, BCRYPT_ROUNDS);

    const [created] = await db
      .insert(gatePins)
      .values({
        propertyId: parseInt(propertyId),
        label: label.trim(),
        pinHash,
        isActive:  true,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        createdBy: userId,
      } as any)
      .returning();

    // Send WhatsApp to guard if phone provided (non-fatal)
    let whatsappSent = false;
    if (guardPhone?.trim()) {
      try {
        const gateUrl = process.env.APP_URL
          ? `${process.env.APP_URL}/gate`
          : "the gate portal";

        whatsappSent = await whatsappService.sendMessage(
          {
            to:      guardPhone.trim(),
            type:    "text",
            content: `🔐 *Gate Access PIN — ${prop.name}*

Hello, your gate access PIN has been set up.

*Label:* ${label.trim()}
*PIN:* ${pin}
*Property:* ${prop.name}

To start your shift, go to: ${gateUrl}
Select *${prop.name}*, enter your PIN, and tap *Start Shift*.

_Do not share this PIN with anyone. It can be changed by your manager at any time._`,
          },
          orgId
        );
        console.log(`[gate-pins] WhatsApp PIN delivery to ${guardPhone}: ${whatsappSent ? "sent" : "failed"}`);
      } catch (waErr) {
        console.warn("[gate-pins] WhatsApp send failed (non-fatal):", waErr);
      }
    }

    return res.status(201).json({ ...sanitizePin(created), whatsappSent });
  } catch (err) {
    console.error("POST /api/gate-pins error:", err);
    return res.status(500).json({ message: "Failed to create gate PIN" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN: PATCH /api/gate-pins/:id/toggle
// ══════════════════════════════════════════════════════════════════════════════
adminRouter.patch("/:id/toggle", ...auth, async (req: any, res: any) => {
  try {
    const id    = parseInt(req.params.id);
    const orgId = req.user.organizationId as number;
    const role  = req.user.role as string;

    // Verify ownership via property join
    const [existing] = await db
      .select({ id: gatePins.id, isActive: gatePins.isActive, propertyId: gatePins.propertyId })
      .from(gatePins)
      .where(eq(gatePins.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ message: "PIN not found" });

    if (!(await canManagePinsFor(existing.propertyId, orgId, role, req.user.id))) {
      return res.status(403).json({ message: "Access denied" });
    }

    const [updated] = await db
      .update(gatePins)
      .set({ isActive: !existing.isActive, updatedAt: new Date() as any })
      .where(eq(gatePins.id, id))
      .returning();

    return res.json(sanitizePin(updated));
  } catch (err) {
    console.error("PATCH /api/gate-pins/:id/toggle error:", err);
    return res.status(500).json({ message: "Failed to toggle PIN" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN: DELETE /api/gate-pins/:id
// ══════════════════════════════════════════════════════════════════════════════
adminRouter.delete("/:id", ...auth, async (req: any, res: any) => {
  try {
    const id    = parseInt(req.params.id);
    const orgId = req.user.organizationId as number;
    const role  = req.user.role as string;

    const [existing] = await db
      .select({ id: gatePins.id, propertyId: gatePins.propertyId })
      .from(gatePins)
      .where(eq(gatePins.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ message: "PIN not found" });

    if (!(await canManagePinsFor(existing.propertyId, orgId, role, req.user.id))) {
      return res.status(403).json({ message: "Access denied" });
    }

    await db.delete(gatePins).where(eq(gatePins.id, id));

    return res.status(204).send();
  } catch (err) {
    console.error("DELETE /api/gate-pins/:id error:", err);
    return res.status(500).json({ message: "Failed to delete PIN" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// PUBLIC: POST /api/gate-auth/login
// Body: { propertyId, pin }
// Returns a short-lived guard JWT scoped to the property
// ══════════════════════════════════════════════════════════════════════════════
authRouter.post("/login", async (req: any, res: any) => {
  try {
    const { propertyId, pin } = req.body;

    if (!propertyId || !pin) {
      return res.status(400).json({ message: "propertyId and pin are required" });
    }

    // Load all active, non-expired PINs for this property
    const now = new Date();
    const candidates = await db
      .select()
      .from(gatePins)
      .where(
        and(
          eq(gatePins.propertyId, parseInt(propertyId)),
          eq(gatePins.isActive, true),
        )
      );

    // Filter out expired ones and try to match the PIN
    const active = candidates.filter(
      (p) => !p.expiresAt || new Date(p.expiresAt) > now
    );

    let matchedPin: typeof active[0] | null = null;
    for (const candidate of active) {
      const ok = await bcrypt.compare(String(pin), candidate.pinHash);
      if (ok) { matchedPin = candidate; break; }
    }

    if (!matchedPin) {
      // Consistent timing to prevent enumeration
      await bcrypt.compare("dummy", "$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234");
      return res.status(401).json({ message: "Incorrect PIN. Please try again." });
    }

    // Fetch property details for the token payload
    const [prop] = await db
      .select({ id: properties.id, name: properties.name, organizationId: properties.organizationId })
      .from(properties)
      .where(eq(properties.id, matchedPin.propertyId))
      .limit(1);

    if (!prop) return res.status(404).json({ message: "Property not found" });

    // Update lastUsedAt
    await db
      .update(gatePins)
      .set({ lastUsedAt: now, updatedAt: now as any })
      .where(eq(gatePins.id, matchedPin.id));

    // Issue guard token — scoped payload, not a full user JWT
    const guardToken = jwt.sign(
      {
        role:           "guard",
        propertyId:     prop.id,
        propertyName:   prop.name,
        organizationId: prop.organizationId,
        pinId:          matchedPin.id,
        label:          matchedPin.label,
      },
      JWT_SECRET,
      { expiresIn: GUARD_TOKEN_TTL }
    );

    // Record shift start
    const [shift] = await db
      .insert(guardShifts)
      .values({
        propertyId:  prop.id,
        pinId:       matchedPin.id,
        label:       matchedPin.label,
        shiftStart:  now,
        deviceHint:  (req.headers["user-agent"] ?? "").slice(0, 200),
      } as any)
      .returning({ id: guardShifts.id });

    return res.json({
      token:        guardToken,
      propertyId:   prop.id,
      propertyName: prop.name,
      label:        matchedPin.label,
      expiresIn:    GUARD_TOKEN_TTL,
      shiftId:      shift?.id ?? null,
    });
  } catch (err) {
    console.error("POST /api/gate-auth/login error:", err);
    return res.status(500).json({ message: "Authentication failed" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// PUBLIC: GET /api/gate-auth/verify
// Authorization: Bearer <guardToken>
// ══════════════════════════════════════════════════════════════════════════════
authRouter.get("/verify", (req: any, res: any) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ valid: false });
    }

    const token   = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET) as any;

    if (decoded.role !== "guard") {
      return res.status(403).json({ valid: false, message: "Not a guard token" });
    }

    return res.json({
      valid:        true,
      propertyId:   decoded.propertyId,
      propertyName: decoded.propertyName,
      label:        decoded.label,
      organizationId: decoded.organizationId,
    });
  } catch {
    return res.status(401).json({ valid: false });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GUARD MIDDLEWARE — use in guest-checkin routes to accept guard tokens
// ══════════════════════════════════════════════════════════════════════════════
export async function authenticateGuard(req: any, res: any, next: any) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Guard authentication required" });
    }

    const token   = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET) as any;

    // Accept EITHER a guard token OR a full admin/manager JWT
    if (decoded.role === "guard") {
      // Re-check the PIN's current status on every request — previously
      // this trusted the token's own claims indefinitely once issued.
      // Deactivating a PIN (e.g. a guard who no longer works there) would
      // block future logins, but an already-issued session — up to 12
      // hours old, the token's TTL — kept working regardless, since
      // nothing here ever looked at the PIN's live isActive state again.
      const [pin] = await db
        .select({ isActive: gatePins.isActive })
        .from(gatePins)
        .where(eq(gatePins.id, decoded.pinId))
        .limit(1);

      if (!pin || !pin.isActive) {
        return res.status(401).json({ message: "This PIN has been deactivated. Please see your manager." });
      }

      req.user = {
        id:             `guard-pin-${decoded.pinId}`,
        userId:         `guard-pin-${decoded.pinId}`,
        role:           "guard",
        organizationId: decoded.organizationId,
        propertyId:     decoded.propertyId,
        label:          decoded.label,
      };
      return next();
    }

    // Fall through to standard JWT check for admin/manager access
    if (decoded.userId && decoded.organizationId) {
      req.user = {
        ...decoded,
        id:     decoded.userId || decoded.sub,
        userId: decoded.userId || decoded.sub,
      };
      return next();
    }

    return res.status(403).json({ message: "Invalid token type" });
  } catch (err: any) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Session expired. Please re-enter your PIN." });
    }
    return res.status(401).json({ message: "Authentication failed" });
  }
}



// ══════════════════════════════════════════════════════════════════════════════
// GUARD: POST /api/gate-auth/end-shift
// Authorization: Bearer <guardToken>
// Records shift end time.
// ══════════════════════════════════════════════════════════════════════════════
authRouter.post("/end-shift", async (req: any, res: any) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Guard token required" });
    }

    const token   = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET) as any;

    if (decoded.role !== "guard") {
      return res.status(403).json({ message: "Not a guard token" });
    }

    const { shiftId } = req.body;

    if (shiftId) {
      // Verify this shift actually belongs to the calling guard's own
      // property/pin before closing it — previously any shiftId was
      // accepted with zero check, letting a guard end another guard's
      // shift at a completely different property.
      const [shift] = await db.select({ id: guardShifts.id })
        .from(guardShifts)
        .where(and(
          eq(guardShifts.id, parseInt(shiftId)),
          eq(guardShifts.propertyId, decoded.propertyId),
          eq(guardShifts.pinId, decoded.pinId),
        ))
        .limit(1);
      if (!shift) return res.status(404).json({ message: "Shift not found" });

      await db
        .update(guardShifts)
        .set({ shiftEnd: new Date() as any })
        .where(eq(guardShifts.id, parseInt(shiftId)));
    } else {
      // Fallback: close any open shift for this property + pin
      await db
        .update(guardShifts)
        .set({ shiftEnd: new Date() as any })
        .where(
          and(
            eq(guardShifts.propertyId, decoded.propertyId),
            eq(guardShifts.pinId, decoded.pinId),
          )
        );
    }

    return res.json({ success: true, shiftEnd: new Date().toISOString() });
  } catch (err: any) {
    if (err.name === "TokenExpiredError") {
      // Token expired but we still want to record end — try by shiftId,
      // still verified against the token's own property/pin. jwt.decode
      // (unverified) is safe here specifically because TokenExpiredError
      // only fires once jwt.verify has already confirmed the signature is
      // genuine — only expiry failed. A forged/tampered token throws
      // JsonWebTokenError instead and never reaches this branch, so this
      // isn't trusting an unverified payload from an arbitrary caller.
      const { shiftId } = req.body;
      if (shiftId) {
        const authHeader = req.headers.authorization;
        const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;
        const decoded = token ? (jwt.decode(token) as any) : null;
        if (!decoded?.propertyId || !decoded?.pinId) {
          return res.status(401).json({ message: "Guard token required" });
        }

        const [shift] = await db.select({ id: guardShifts.id })
          .from(guardShifts)
          .where(and(
            eq(guardShifts.id, parseInt(shiftId)),
            eq(guardShifts.propertyId, decoded.propertyId),
            eq(guardShifts.pinId, decoded.pinId),
          ))
          .limit(1);
        if (!shift) return res.status(404).json({ message: "Shift not found" });

        await db.update(guardShifts)
          .set({ shiftEnd: new Date() as any })
          .where(eq(guardShifts.id, parseInt(shiftId)));
        return res.json({ success: true });
      }
    }
    console.error("POST /api/gate-auth/end-shift error:", err);
    return res.status(500).json({ message: "Failed to record shift end" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN: GET /api/gate-auth/shifts?propertyId=X
// Returns recent shift logs for a property (requires full JWT).
// ══════════════════════════════════════════════════════════════════════════════
authRouter.get("/shifts", authenticateJWT as any, requireOrg as any, async (req: any, res: any) => {
  try {
    const orgId      = req.user.organizationId as number;
    const propertyId = parseInt(req.query.propertyId as string);

    if (!propertyId) return res.status(400).json({ message: "propertyId is required" });

    // Verify property belongs to org
    const [prop] = await db
      .select({ id: properties.id })
      .from(properties)
      .where(and(eq(properties.id, propertyId), eq(properties.organizationId, orgId)))
      .limit(1);

    if (!prop) return res.status(404).json({ message: "Property not found" });

    const shifts = await db
      .select()
      .from(guardShifts)
      .where(eq(guardShifts.propertyId, propertyId))
      .orderBy(desc(guardShifts.shiftStart))
      .limit(100);

    return res.json(shifts);
  } catch (err) {
    console.error("GET /api/gate-auth/shifts error:", err);
    return res.status(500).json({ message: "Failed to fetch shifts" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GUARDED: GET /api/gate-auth/properties
// Returns only the single property the authenticated guard is assigned to.
// Requires a valid guard token — guards must NOT see other properties.
// ══════════════════════════════════════════════════════════════════════════════
authRouter.get("/properties", authenticateGuard, async (req: any, res: any) => {
  try {
    const guardPropertyId: number = req.user.propertyId;

    if (!guardPropertyId) {
      return res.status(403).json({ message: "Guard token has no property assignment" });
    }

    const [prop] = await db
      .select({
        id:   properties.id,
        name: properties.name,
      })
      .from(properties)
      .where(eq(properties.id, guardPropertyId))
      .limit(1);

    if (!prop) {
      return res.status(404).json({ message: "Assigned property not found" });
    }

    // Return as an array so the client dropdown code stays unchanged
    return res.json([prop]);
  } catch (err) {
    console.error("GET /api/gate-auth/properties error:", err);
    return res.status(500).json({ message: "Failed to fetch properties" });
  }
});

export { adminRouter as gatePinsRouter, authRouter as gateAuthRouter };