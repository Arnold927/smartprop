/**
 * prospects.ts — mounted at /api/prospects
 *
 * Letting pipeline: new → viewing → application → reference check → approved/rejected → lease offered → converted
 *
 *   GET    /api/prospects                      list (filterable by propertyId, unitId, status)
 *   GET    /api/prospects/pipeline/:propertyId kanban data grouped by status
 *   GET    /api/prospects/:id                  single prospect
 *   POST   /api/prospects                      create (walk-in or from public form)
 *   PATCH  /api/prospects/:id                  update any field
 *   POST   /api/prospects/:id/schedule-viewing set viewing date + assign agent
 *   POST   /api/prospects/:id/submit-application  advance to application_submitted
 *   POST   /api/prospects/:id/check-references    advance to reference_checked
 *   POST   /api/prospects/:id/approve            approve → lease_offered
 *   POST   /api/prospects/:id/reject             reject with reason
 *   POST   /api/prospects/:id/convert            convert to tenant (creates tenant record)
 *
 *   Public (no auth):
 *   POST   /api/prospects/apply               tenant application form — no JWT required
 */

import { Router }    from "express";
import { db }        from "../db";
import {
  prospects, properties, units, tenants, users,
} from "@shared/schema";
import { eq, and, desc, asc, inArray, sql } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg }      from "../middleware/requireOrg";

const router = Router();
const auth   = [authenticateJWT as any, requireOrg as any];

// Pipeline stages in display order
const PIPELINE_STAGES = [
  "new",
  "viewing_scheduled",
  "viewed",
  "application_submitted",
  "reference_checked",
  "approved",
  "lease_offered",
  "converted",
  "rejected",
] as const;

// ─── Helper ───────────────────────────────────────────────────────────────────

async function advanceStatus(
  id: number,
  orgId: number,
  newStatus: string,
  extraFields: Record<string, any> = {},
) {
  const [updated] = await db
    .update(prospects)
    .set({ status: newStatus, ...extraFields, updatedAt: new Date() })
    .where(and(eq(prospects.id, id), eq(prospects.organizationId, orgId)))
    .returning();
  return updated;
}

// ══════════════════════════════════════════════════════════════════════════════
// PUBLIC APPLICATION FORM — no auth required
// POST /api/prospects/apply
// ══════════════════════════════════════════════════════════════════════════════

router.post("/apply", async (req: any, res: any) => {
  try {
    const {
      organizationId, propertyId, unitId,
      firstName, lastName, email, phone, nationalId,
      employer, jobTitle, monthlyIncome, employmentType,
      reference1Name, reference1Phone, reference1Relation,
      reference2Name, reference2Phone, reference2Relation,
      preferredMoveIn, budgetMin, budgetMax,
    } = req.body;

    if (!organizationId || !firstName || !lastName || !email) {
      return res.status(400).json({ message: "organizationId, firstName, lastName, and email are required" });
    }

    // Verify org exists and is active
    const { organizations } = await import("@shared/schema");
    const [org] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (!org) return res.status(404).json({ message: "Organisation not found" });

    const [created] = await db.insert(prospects).values({
      organizationId,
      propertyId:              propertyId ?? null,
      unitId:                  unitId     ?? null,
      firstName:               firstName.trim(),
      lastName:                lastName.trim(),
      email:                   email.toLowerCase().trim(),
      phone:                   phone     ?? null,
      nationalId:              nationalId ?? null,
      employer:                employer  ?? null,
      jobTitle:                jobTitle  ?? null,
      monthlyIncome:           monthlyIncome  ? String(monthlyIncome)  : null,
      employmentType:          employmentType ?? null,
      reference1Name:          reference1Name  ?? null,
      reference1Phone:         reference1Phone ?? null,
      reference1Relation:      reference1Relation ?? null,
      reference2Name:          reference2Name  ?? null,
      reference2Phone:         reference2Phone ?? null,
      reference2Relation:      reference2Relation ?? null,
      preferredMoveIn:         preferredMoveIn ?? null,
      budgetMin:               budgetMin ? String(budgetMin) : null,
      budgetMax:               budgetMax ? String(budgetMax) : null,
      status:                  "application_submitted",
      source:                  "website",
      applicationSubmittedAt:  new Date(),
    } as any).returning();

    res.status(201).json({
      id:     created.id,
      message: "Application received. We will be in touch within 2 business days.",
    });
  } catch (err: any) {
    console.error("public apply error:", err);
    res.status(500).json({ message: "Failed to submit application. Please try again." });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// LIST
// ══════════════════════════════════════════════════════════════════════════════

router.get("/", ...auth, async (req: any, res: any) => {
  try {
    const orgId      = req.user.organizationId;
    const propertyId = req.query.propertyId ? parseInt(req.query.propertyId as string) : null;
    const unitId     = req.query.unitId     ? parseInt(req.query.unitId     as string) : null;
    const status     = req.query.status     as string | null;

    const conditions: any[] = [eq(prospects.organizationId, orgId)];
    if (propertyId) conditions.push(eq(prospects.propertyId, propertyId));
    if (unitId)     conditions.push(eq(prospects.unitId,     unitId));
    if (status)     conditions.push(eq(prospects.status,     status));

    const rows = await db
      .select({
        id:             prospects.id,
        firstName:      prospects.firstName,
        lastName:       prospects.lastName,
        email:          prospects.email,
        phone:          prospects.phone,
        propertyId:     prospects.propertyId,
        unitId:         prospects.unitId,
        status:         prospects.status,
        source:         prospects.source,
        viewingDate:    prospects.viewingDate,
        budgetMax:      prospects.budgetMax,
        preferredMoveIn:prospects.preferredMoveIn,
        assignedTo:     prospects.assignedTo,
        approvedAt:     prospects.approvedAt,
        rejectedAt:     prospects.rejectedAt,
        convertedAt:    prospects.convertedAt,
        createdAt:      prospects.createdAt,
        updatedAt:      prospects.updatedAt,
        // Joins
        propertyName:   properties.name,
        unitNumber:     units.unitNumber,
      })
      .from(prospects)
      .leftJoin(properties, eq(prospects.propertyId, properties.id))
      .leftJoin(units,      eq(prospects.unitId,     units.id))
      .where(and(...conditions))
      .orderBy(desc(prospects.updatedAt));

    res.json(rows);
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// KANBAN / PIPELINE VIEW — grouped by status for a given property
// GET /api/prospects/pipeline/:propertyId
// ══════════════════════════════════════════════════════════════════════════════

router.get("/pipeline/:propertyId", ...auth, async (req: any, res: any) => {
  try {
    const orgId      = req.user.organizationId;
    const propertyId = parseInt(req.params.propertyId);

    const rows = await db
      .select({
        id:          prospects.id,
        firstName:   prospects.firstName,
        lastName:    prospects.lastName,
        email:       prospects.email,
        phone:       prospects.phone,
        unitId:      prospects.unitId,
        status:      prospects.status,
        budgetMax:   prospects.budgetMax,
        viewingDate: prospects.viewingDate,
        createdAt:   prospects.createdAt,
        unitNumber:  units.unitNumber,
      })
      .from(prospects)
      .leftJoin(units, eq(prospects.unitId, units.id))
      .where(and(
        eq(prospects.organizationId, orgId),
        eq(prospects.propertyId,     propertyId),
      ))
      .orderBy(asc(prospects.createdAt));

    // Group into kanban columns
    const pipeline = Object.fromEntries(
      PIPELINE_STAGES.map(stage => [
        stage,
        rows.filter(r => r.status === stage).map(r => ({
          ...r,
          fullName: `${r.firstName} ${r.lastName}`,
        })),
      ])
    );

    // Vacancy summary for this property
    const propUnits = await db
      .select({ id: units.id, unitNumber: units.unitNumber, isOccupied: units.isOccupied, monthlyRent: units.monthlyRent })
      .from(units)
      .where(eq(units.propertyId, propertyId));

    const vacantUnits = propUnits.filter(u => !u.isOccupied);

    res.json({ pipeline, vacantUnits, totalProspects: rows.length });
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// SINGLE
// ══════════════════════════════════════════════════════════════════════════════

router.get("/:id", ...auth, async (req: any, res: any) => {
  try {
    const [row] = await db
      .select()
      .from(prospects)
      .where(and(
        eq(prospects.id,             parseInt(req.params.id)),
        eq(prospects.organizationId, req.user.organizationId),
      ))
      .limit(1);
    if (!row) return res.status(404).json({ message: "Prospect not found" });
    res.json(row);
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// CREATE (walk-in / agent entry)
// ══════════════════════════════════════════════════════════════════════════════

router.post("/", ...auth, async (req: any, res: any) => {
  try {
    const orgId = req.user.organizationId;
    const { firstName, lastName, email } = req.body;
    if (!firstName || !lastName || !email) {
      return res.status(400).json({ message: "firstName, lastName, and email are required" });
    }

    const [created] = await db.insert(prospects).values({
      ...req.body,
      email:          (req.body.email as string).toLowerCase().trim(),
      organizationId: orgId,
      status:         req.body.status ?? "new",
      source:         req.body.source ?? "walk_in",
    } as any).returning();

    res.status(201).json(created);
  } catch (err: any) { res.status(400).json({ message: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// GENERIC UPDATE
// ══════════════════════════════════════════════════════════════════════════════

router.patch("/:id", ...auth, async (req: any, res: any) => {
  try {
    const [updated] = await db
      .update(prospects)
      .set({ ...req.body, updatedAt: new Date() })
      .where(and(
        eq(prospects.id,             parseInt(req.params.id)),
        eq(prospects.organizationId, req.user.organizationId),
      ))
      .returning();
    if (!updated) return res.status(404).json({ message: "Prospect not found" });
    res.json(updated);
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// PIPELINE ACTIONS
// ══════════════════════════════════════════════════════════════════════════════

// POST /api/prospects/:id/schedule-viewing
router.post("/:id/schedule-viewing", ...auth, async (req: any, res: any) => {
  try {
    const { viewingDate, viewingNotes, assignedTo } = req.body;
    if (!viewingDate) return res.status(400).json({ message: "viewingDate is required" });
    const updated = await advanceStatus(parseInt(req.params.id), req.user.organizationId, "viewing_scheduled", {
      viewingDate: new Date(viewingDate),
      viewingNotes: viewingNotes ?? null,
      viewingConductedBy: assignedTo ?? req.user.id,
      assignedTo: assignedTo ?? req.user.id,
    });
    if (!updated) return res.status(404).json({ message: "Prospect not found" });
    res.json(updated);
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// POST /api/prospects/:id/submit-application (when agent manually records it)
router.post("/:id/submit-application", ...auth, async (req: any, res: any) => {
  try {
    const updated = await advanceStatus(parseInt(req.params.id), req.user.organizationId, "application_submitted", {
      applicationSubmittedAt: new Date(),
      applicationNotes: req.body.notes ?? null,
    });
    if (!updated) return res.status(404).json({ message: "Prospect not found" });
    res.json(updated);
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// POST /api/prospects/:id/check-references
router.post("/:id/check-references", ...auth, async (req: any, res: any) => {
  try {
    const updated = await advanceStatus(parseInt(req.params.id), req.user.organizationId, "reference_checked", {
      referencesCheckedAt:  new Date(),
      referencesCheckedBy:  req.user.id,
      referenceCheckNotes:  req.body.notes ?? null,
    });
    if (!updated) return res.status(404).json({ message: "Prospect not found" });
    res.json(updated);
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// POST /api/prospects/:id/approve
router.post("/:id/approve", ...auth, async (req: any, res: any) => {
  try {
    const updated = await advanceStatus(parseInt(req.params.id), req.user.organizationId, "approved", {
      approvedAt:    new Date(),
      approvedBy:    req.user.id,
      offeredRent:   req.body.offeredRent ? String(req.body.offeredRent) : null,
      leaseOfferedAt: new Date(),
    });
    if (!updated) return res.status(404).json({ message: "Prospect not found" });
    res.json(updated);
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

// POST /api/prospects/:id/reject
router.post("/:id/reject", ...auth, async (req: any, res: any) => {
  try {
    if (!req.body.reason) return res.status(400).json({ message: "reason is required" });
    const updated = await advanceStatus(parseInt(req.params.id), req.user.organizationId, "rejected", {
      rejectedAt:      new Date(),
      rejectionReason: req.body.reason,
    });
    if (!updated) return res.status(404).json({ message: "Prospect not found" });
    res.json(updated);
  } catch (err: any) { res.status(500).json({ message: err.message }); }
});

/**
 * POST /api/prospects/:id/convert
 * Converts an approved prospect into an active tenant.
 * Body: { unitId, monthlyRent, leaseStartDate, leaseEndDate, securityDeposit }
 */
router.post("/:id/convert", ...auth, async (req: any, res: any) => {
  try {
    const orgId = req.user.organizationId;
    const [prospect] = await db
      .select()
      .from(prospects)
      .where(and(eq(prospects.id, parseInt(req.params.id)), eq(prospects.organizationId, orgId)))
      .limit(1);

    if (!prospect) return res.status(404).json({ message: "Prospect not found" });
    if (!["approved", "lease_offered"].includes(prospect.status ?? "")) {
      return res.status(400).json({ message: "Prospect must be approved before converting to tenant" });
    }

    const { unitId, monthlyRent, leaseStartDate, leaseEndDate, securityDeposit } = req.body;
    if (!unitId) return res.status(400).json({ message: "unitId is required" });

    // Get or create user account for the prospect
    const { users: usersTable } = await import("@shared/schema");
    let userId: string;
    const [existingUser] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, prospect.email))
      .limit(1);

    if (existingUser) {
      userId = existingUser.id;
    } else {
      const crypto = await import("crypto");
      const bcrypt = await import("bcrypt");
      const tempPwd = crypto.randomBytes(16).toString("hex");
      const hash    = await bcrypt.hash(tempPwd, 10);
      const [newUser] = await db.insert(usersTable).values({
        email:        prospect.email,
        firstName:    prospect.firstName,
        lastName:     prospect.lastName,
        passwordHash: hash,
        organizationId: orgId,
        role:         "tenant",
        phoneNumber:  prospect.phone ?? null,
      } as any).returning();
      userId = newUser.id;
    }

    // Create the tenant record
    const [newTenant] = await db.insert(tenants).values({
      organizationId: orgId,
      userId,
      firstName:      prospect.firstName,
      lastName:       prospect.lastName,
      email:          prospect.email,
      phone:          prospect.phone ?? null,
      unitId,
      monthlyRent:    monthlyRent ? String(monthlyRent) : String(prospect.offeredRent ?? 0),
      securityDeposit: securityDeposit ? String(securityDeposit) : null,
      leaseStartDate:  leaseStartDate ?? null,
      leaseEndDate:    leaseEndDate   ?? null,
      status:          "active",
    } as any).returning();

    // Mark unit as occupied
    await db.update(units).set({ isOccupied: true }).where(eq(units.id, unitId));

    // Mark prospect as converted
    await db.update(prospects).set({
      status:                "converted",
      convertedToTenantId:   newTenant.id,
      convertedAt:           new Date(),
      updatedAt:             new Date(),
    }).where(eq(prospects.id, prospect.id));

    res.status(201).json({
      tenant:  newTenant,
      userId,
      message: "Prospect successfully converted to tenant. An invitation email will be sent.",
    });
  } catch (err: any) {
    console.error("convert prospect error:", err);
    res.status(500).json({ message: err.message });
  }
});

export default router;
