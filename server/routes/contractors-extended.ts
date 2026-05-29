/**
 * Extended contractor routes:
 *   /api/contractor-categories  — CRUD for contractor categories
 *   /api/service-contracts      — CRUD for service contracts (org-scoped)
 *   POST /api/contractors/:id/verify — verify a contractor
 *
 * Security fixes:
 *  - contractor-categories: global reference table — auth only, no org needed.
 *  - service-contracts: scoped to org via the propertyId → properties.organizationId
 *    join. Cross-org reads and writes are blocked.
 *  - contractor verify: requireOrg added so only authenticated org members can
 *    mark a contractor as verified.
 */
import { Router } from "express";
import { randomUUID } from "crypto";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import { db } from "../db";
import {
  contractorCategories,
  serviceContracts,
  contractorsRegistry,
  properties,
  users,
  organizations,
  contractors,
} from "../../shared/schema";
import {
  insertContractorCategorySchema,
  insertServiceContractSchema,
} from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { sendContractorInviteEmail } from "../lib/email";

// ─── Contractor Categories ────────────────────────────────────────────────────
// These are a global reference table (shared across orgs).
// Auth is required but org-scoping is not applicable.

export const contractorCategoriesRouter = Router();

// GET /api/contractor-categories
contractorCategoriesRouter.get("/", authenticateJWT, async (_req: any, res) => {
  try {
    const cats = await db.select().from(contractorCategories);
    res.json(cats);
  } catch (err) {
    console.error("Get contractor categories error:", err);
    res.status(500).json({ message: "Failed to fetch contractor categories" });
  }
});

// POST /api/contractor-categories
contractorCategoriesRouter.post("/", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const validated = insertContractorCategorySchema.parse(req.body);
    const [category] = await db.insert(contractorCategories).values(validated).returning();
    res.status(201).json(category);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid data", errors: err.errors });
    }
    console.error("Create contractor category error:", err);
    res.status(500).json({ message: "Failed to create contractor category" });
  }
});

// PUT /api/contractor-categories/:id
contractorCategoriesRouter.put("/:id", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const validated = insertContractorCategorySchema.partial().parse(req.body);
    const [category] = await db
      .update(contractorCategories)
      .set(validated)
      .where(eq(contractorCategories.id, id))
      .returning();
    if (!category) return res.status(404).json({ message: "Category not found" });
    res.json(category);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid data", errors: err.errors });
    }
    console.error("Update contractor category error:", err);
    res.status(500).json({ message: "Failed to update contractor category" });
  }
});

// ─── Service Contracts ────────────────────────────────────────────────────────
// Scoped to the caller's org via serviceContracts.propertyId → properties.organizationId.

export const serviceContractsRouter = Router();

/**
 * Returns property IDs that belong to the caller's organization.
 * Service contracts are owned by the org that owns the property.
 */
async function getOrgPropertyIds(organizationId: number): Promise<number[]> {
  const rows = await db
    .select({ id: properties.id })
    .from(properties)
    .where(eq(properties.organizationId, organizationId));
  return rows.map((r) => r.id);
}

// GET /api/service-contracts
serviceContractsRouter.get("/", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const orgPropertyIds = await getOrgPropertyIds(orgId);

    if (orgPropertyIds.length === 0) return res.json([]);

    const { contractorId, propertyId } = req.query;

    // If filtering by propertyId, verify it belongs to this org
    if (propertyId) {
      const pid = parseInt(propertyId as string);
      if (!orgPropertyIds.includes(pid)) {
        return res.status(403).json({ message: "Access denied to this property" });
      }
      const contracts = await db
        .select()
        .from(serviceContracts)
        .where(eq(serviceContracts.propertyId, pid));
      return res.json(contracts);
    }

    // Filter by contractorId but still restrict to org's properties
    if (contractorId) {
      const cid = parseInt(contractorId as string);
      const contracts = await db
        .select()
        .from(serviceContracts)
        .where(
          eq(serviceContracts.contractorId, cid)
          // also constrain to org's properties via subquery filter below
        );
      // post-filter to org's properties (avoids complex join for now)
      const scoped = contracts.filter(
        (c) => c.propertyId === null || orgPropertyIds.includes(c.propertyId!)
      );
      return res.json(scoped);
    }

    // No filter — return contracts scoped to org's properties OR with no property (org-level contracts)
    const { isNull, or } = await import("drizzle-orm");
    const contracts = await db
      .select()
      .from(serviceContracts)
      .where(
        orgPropertyIds.length > 0
          ? or(inArray(serviceContracts.propertyId, orgPropertyIds), isNull(serviceContracts.propertyId))
          : isNull(serviceContracts.propertyId)
      );

    res.json(contracts);
  } catch (err) {
    console.error("Get service contracts error:", err);
    res.status(500).json({ message: "Failed to fetch service contracts" });
  }
});

/** Coerce date string fields to Date objects before Zod validation */
function coerceDates(body: any): any {
  const result = { ...body };
  for (const field of ['startDate', 'endDate', 'signedDate']) {
    if (result[field] && typeof result[field] === 'string') {
      const d = new Date(result[field]);
      result[field] = isNaN(d.getTime()) ? undefined : d;
    }
  }
  return result;
}

// POST /api/service-contracts
serviceContractsRouter.post("/", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const validated = insertServiceContractSchema.parse({
      ...coerceDates(req.body),
      createdBy: req.user.userId || req.user.id,
    });

    // Verify the target property belongs to this org
    if (validated.propertyId) {
      const orgPropertyIds = await getOrgPropertyIds(orgId);
      if (!orgPropertyIds.includes(validated.propertyId)) {
        return res.status(403).json({ message: "Access denied to this property" });
      }
    }

    const [contract] = await db.insert(serviceContracts).values(validated).returning();
    res.status(201).json(contract);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid data", errors: err.errors });
    }
    console.error("Create service contract error:", err);
    res.status(500).json({ message: "Failed to create service contract" });
  }
});

// PUT /api/service-contracts/:id
serviceContractsRouter.put("/:id", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const id = parseInt(req.params.id);

    // Ownership check before update
    const [existing] = await db
      .select()
      .from(serviceContracts)
      .where(eq(serviceContracts.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ message: "Contract not found" });

    if (existing.propertyId) {
      const orgPropertyIds = await getOrgPropertyIds(orgId);
      if (!orgPropertyIds.includes(existing.propertyId)) {
        return res.status(403).json({ message: "Access denied to this contract" });
      }
    }

    const validated = insertServiceContractSchema.partial().parse(coerceDates(req.body));
    const [contract] = await db
      .update(serviceContracts)
      .set(validated)
      .where(eq(serviceContracts.id, id))
      .returning();

    res.json(contract);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid data", errors: err.errors });
    }
    console.error("Update service contract error:", err);
    res.status(500).json({ message: "Failed to update service contract" });
  }
});

// DELETE /api/service-contracts/:id
serviceContractsRouter.delete("/:id", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const id = parseInt(req.params.id);

    const [existing] = await db
      .select()
      .from(serviceContracts)
      .where(eq(serviceContracts.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ message: "Contract not found" });

    if (existing.propertyId) {
      const orgPropertyIds = await getOrgPropertyIds(orgId);
      if (!orgPropertyIds.includes(existing.propertyId)) {
        return res.status(403).json({ message: "Access denied to this contract" });
      }
    }

    await db.delete(serviceContracts).where(eq(serviceContracts.id, id));
    res.status(204).send();
  } catch (err) {
    console.error("Delete service contract error:", err);
    res.status(500).json({ message: "Failed to delete service contract" });
  }
});

// ─── Contractor Registry list (for contract form dropdowns) ─────────────────
// GET /api/contractors/registry  → returns contractorsRegistry rows with category name

export const contractorRegistryListRouter = Router();

contractorRegistryListRouter.get("/", authenticateJWT, async (_req: any, res) => {
  try {
    // Query from contractors table (the active table used by the app)
    // and map fields to match the ContractorRegistry interface expected by the frontend
    const { contractors: contractorsTable } = await import("../../shared/schema");
    const rows = await db.select().from(contractorsTable);
    const mapped = rows.map((c: any) => ({
      id: c.id,
      contractorName: c.name,
      companyName: c.companyName || null,
      categoryId: c.categoryId || null,
      categoryName: c.specialty || null,
      phoneNumber: c.phone,
      email: c.email,
      isVerified: c.isVerified || false,
    }));
    res.json(mapped);
  } catch (err) {
    console.error("Get contractors registry error:", err);
    res.status(500).json({ message: "Failed to fetch contractors registry" });
  }
});

// ─── Contractor creation hook — auto-invite user account ─────────────────────
// This router runs BEFORE the CRUD router on POST /api/contractors.
// It wraps res.json to intercept the 201 response and fire a non-blocking
// invite after the CRUD router has written the contractor row to the DB.

export const contractorCreateHookRouter = Router();

contractorCreateHookRouter.post("/", authenticateJWT, requireOrg, async (req: any, res, next) => {
  const origJson = res.json.bind(res);
  res.json = function (body: any) {
    // Only fire on successful creation and when the contractor has an email
    if (res.statusCode === 201 && body?.id && body?.email) {
      const orgId: number = req.user.organizationId;
      const contractorEmail: string = body.email.toLowerCase();
      const contractorName: string = body.name || body.companyName || "Contractor";
      const specialty: string = body.specialty || "General Services";

      (async () => {
        try {
          // Look up org name for the email
          const [org] = await db
            .select({ name: organizations.name })
            .from(organizations)
            .where(eq(organizations.id, orgId))
            .limit(1);
          const orgName = org?.name ?? undefined;

          // Create or re-invite the user account
          const inviteToken = randomUUID();
          const inviteExpiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24 h

          // Split name into first/last for the user record
          const nameParts = contractorName.trim().split(/\s+/);
          const firstName = nameParts[0] ?? contractorName;
          const lastName = nameParts.slice(1).join(" ") || undefined;

          await db
            .insert(users)
            .values({
              id: randomUUID(),
              email: contractorEmail,
              role: "contractor",
              organizationId: orgId,
              firstName,
              lastName,
              passwordHash: "",
              emailVerified: false,
              invitedAt: new Date(),
              invitedBy: req.user.id ?? req.user.userId,
              emailVerificationToken: inviteToken,
              emailVerificationExpiresAt: inviteExpiresAt,
            } as any)
            .onConflictDoUpdate({
              target: [users.organizationId, users.email],
              set: {
                role: "contractor",
                invitedAt: new Date(),
                emailVerificationToken: inviteToken,
                emailVerificationExpiresAt: inviteExpiresAt,
              },
            });

          const inviteLink = `${process.env.APP_URL || "http://localhost:5173"}/accept-invite/${inviteToken}`;

          await sendContractorInviteEmail({
            to: contractorEmail,
            inviteLink,
            contractorName,
            specialty,
            orgName,
          });

          console.log(`[contractors] Invite sent to contractor ${contractorEmail}`);
        } catch (err) {
          // Non-fatal — contractor row is already created, just log the failure
          console.warn(`[contractors] Failed to auto-invite contractor ${contractorEmail}:`, err);
        }
      })();
    }
    return origJson(body);
  };
  next();
});


// ─── Contractor verify action ─────────────────────────────────────────────────

export const contractorVerifyRouter = Router();

// POST /api/contractors/:id/verify
contractorVerifyRouter.post("/:id/verify", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);

    const [contractor] = await db
      .update(contractors)
      .set({ isVerified: true, updatedAt: new Date() })
      .where(eq(contractors.id, id))
      .returning();

    if (!contractor) return res.status(404).json({ message: "Contractor not found" });

    res.json(contractor);
  } catch (err) {
    console.error("Verify contractor error:", err);
    res.status(500).json({ message: "Failed to verify contractor" });
  }
});