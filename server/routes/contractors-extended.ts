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
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import { db } from "../db";
import {
  contractorCategories,
  serviceContracts,
  contractorsRegistry,
  properties,
  contractors,
  users,
  workOrders,
} from "../../shared/schema";
import {
  insertContractorCategorySchema,
  insertServiceContractSchema,
} from "@shared/schema";
import { eq, and, or, sql, ilike } from "drizzle-orm";
import { z } from "zod";
import { issueInvite, deliverInvite } from "../utils/invites";
import { randomUUID } from "crypto";

// ─── helpers ──────────────────────────────────────────────────────────────────

const MANAGERS = ["admin", "manager", "platform_admin"];
const isManagerRole = (role: string) => MANAGERS.includes(role);
const fail = (res: any, status: number, message: string, extra: object = {}) => res.status(status).json({ message, ...extra });
const MAX_MONEY = 99_999_999;

// ─── Contractor Categories ────────────────────────────────────────────────────
// A reference list shared by every organisation. Anyone signed in can read it. Adding a category is for managers
// (a duplicate name is refused). Renaming or changing one changes it for every organisation, so that is the
// platform admin's alone.

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
    if (!isManagerRole(req.user.role)) return fail(res, 403, "Only an admin or manager can add a category.");
    const validated = insertContractorCategorySchema.parse({ ...req.body, id: undefined, name: String(req.body?.name ?? "").trim() });
    if (!validated.name) return fail(res, 400, "Give the category a name.");
    if (validated.name.length > 100) return fail(res, 400, "The category name is too long.");
    const [dup] = await db.select({ id: contractorCategories.id }).from(contractorCategories).where(ilike(contractorCategories.name, validated.name)).limit(1);
    if (dup) return fail(res, 409, `There is already a category called "${validated.name}".`);
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
    if (req.user.role !== "platform_admin") return fail(res, 403, "Categories are shared by every organisation, so only the platform admin can change them.");
    const id = parseInt(req.params.id);
    const validated = insertContractorCategorySchema.partial().parse({ ...req.body, id: undefined });
    if (validated.name !== undefined) {
      validated.name = String(validated.name).trim();
      if (!validated.name) return fail(res, 400, "Give the category a name.");
      const [dup] = await db.select({ id: contractorCategories.id }).from(contractorCategories).where(ilike(contractorCategories.name, validated.name)).limit(1);
      if (dup && dup.id !== id) return fail(res, 409, `There is already a category called "${validated.name}".`);
    }
    const [category] = await db
      .update(contractorCategories)
      .set({ ...validated, updatedAt: new Date() })
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
// A contract belongs to the organisation that made it. That is decided from who created it, the property it is for and
// the contractor it is with. A contract with no property used to be visible to, and editable by, every organisation.

export const serviceContractsRouter = Router();

const CONTRACT_TYPES = ["one_time", "recurring", "retainer"];
const CONTRACT_STATUSES = ["draft", "active", "completed", "terminated"];
const CONTRACT_MOVES: Record<string, string[]> = {
  draft: ["active", "terminated"],
  active: ["completed", "terminated"],
  completed: [],
  terminated: [],
};

/** The conditions that say "this contract belongs to organisation `orgId`". */
const contractInOrg = (orgId: number) =>
  or(eq(users.organizationId, orgId), eq(properties.organizationId, orgId), eq(contractors.organizationId, orgId));

async function loadContract(id: number, orgId: number) {
  const [row] = await db
    .select({ contract: serviceContracts, propertyOwnerId: properties.ownerId })
    .from(serviceContracts)
    .leftJoin(properties, eq(serviceContracts.propertyId, properties.id))
    .leftJoin(contractors, eq(serviceContracts.contractorId, contractors.id))
    .leftJoin(users, eq(serviceContracts.createdBy, users.id))
    .where(and(eq(serviceContracts.id, id), contractInOrg(orgId)))
    .limit(1);
  return row ?? null;
}

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

/** Checks a contract's own figures and links. Returns the message to show, or null. */
async function checkContract(c: any, orgId: number): Promise<string | null> {
  if (c.contractType !== undefined && !CONTRACT_TYPES.includes(c.contractType)) return "Contract type must be one-time, recurring or retainer.";
  if (c.status !== undefined && !CONTRACT_STATUSES.includes(c.status)) return "Status must be draft, active, completed or terminated.";
  if (c.contractValue !== undefined && c.contractValue !== null) {
    const v = Number(c.contractValue);
    if (!isFinite(v) || v < 0 || v > MAX_MONEY) return "The contract value must be a valid amount.";
  }
  if (c.startDate && c.endDate && new Date(c.endDate) < new Date(c.startDate)) return "The end date can't be before the start date.";
  if (c.contractorId) {
    const [k] = await db.select({ id: contractors.id }).from(contractors).where(and(eq(contractors.id, c.contractorId), eq(contractors.organizationId, orgId))).limit(1);
    if (!k) return "That contractor isn't in your organisation.";
  }
  if (c.propertyId) {
    const [p] = await db.select({ id: properties.id }).from(properties).where(and(eq(properties.id, c.propertyId), eq(properties.organizationId, orgId))).limit(1);
    if (!p) return "That property isn't in your organisation.";
  }
  return null;
}

// GET /api/service-contracts
serviceContractsRouter.get("/", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const conds = [contractInOrg(orgId)!];
    // A landlord sees only the contracts on properties they own.
    if (req.user.role === "landlord") conds.push(eq(properties.ownerId, req.user.id));
    const pid = req.query.propertyId ? parseInt(req.query.propertyId as string) : NaN;
    const cid = req.query.contractorId ? parseInt(req.query.contractorId as string) : NaN;
    if (req.query.propertyId && !Number.isInteger(pid)) return fail(res, 400, "Invalid property.");
    if (req.query.contractorId && !Number.isInteger(cid)) return fail(res, 400, "Invalid contractor.");
    if (Number.isInteger(pid)) conds.push(eq(serviceContracts.propertyId, pid));
    if (Number.isInteger(cid)) conds.push(eq(serviceContracts.contractorId, cid));

    const rows = await db
      .select({ contract: serviceContracts })
      .from(serviceContracts)
      .leftJoin(properties, eq(serviceContracts.propertyId, properties.id))
      .leftJoin(contractors, eq(serviceContracts.contractorId, contractors.id))
      .leftJoin(users, eq(serviceContracts.createdBy, users.id))
      .where(and(...conds));
    res.json(rows.map((r) => r.contract));
  } catch (err) {
    console.error("Get service contracts error:", err);
    res.status(500).json({ message: "Failed to fetch service contracts" });
  }
});

// POST /api/service-contracts
serviceContractsRouter.post("/", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    if (!["admin", "manager", "staff", "platform_admin"].includes(req.user.role)) return fail(res, 403, "Only the management team can create a service contract.");
    const orgId: number = req.user.organizationId;
    const body = coerceDates(req.body);
    const number = typeof body.contractNumber === "string" && body.contractNumber.trim() ? body.contractNumber.trim().slice(0, 50) : `SC-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`;
    // The contract starts as a draft unless it says otherwise, and never carries a signature it didn't get.
    const validated = insertServiceContractSchema.parse({
      ...body, contractNumber: number, status: body.status ?? "draft",
      signedBy: undefined, signedDate: undefined,
      createdBy: req.user.userId || req.user.id,
    });
    if (!validated.contractorId) return fail(res, 400, "Choose the contractor this contract is with.");
    const msg = await checkContract(validated, orgId);
    if (msg) return fail(res, 400, msg);
    if (validated.status !== "draft" && validated.status !== "active") return fail(res, 400, "A new contract is either a draft or active.");

    const [dup] = await db.select({ id: serviceContracts.id }).from(serviceContracts).where(eq(serviceContracts.contractNumber, number)).limit(1);
    if (dup) return fail(res, 409, `Contract number ${number} is already used.`);
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
    if (!["admin", "manager", "staff", "platform_admin"].includes(req.user.role)) return fail(res, 403, "Only the management team can change a service contract.");
    const orgId: number = req.user.organizationId;
    const id = parseInt(req.params.id);
    const found = await loadContract(id, orgId);
    if (!found) return res.status(404).json({ message: "Contract not found" });
    const existing = found.contract;

    const body = coerceDates(req.body);
    // Who made it, its number and its signature are not editable here.
    for (const k of ["id", "createdBy", "createdAt", "contractNumber", "signedBy", "signedDate"]) delete body[k];
    const validated = insertServiceContractSchema.partial().parse(body);
    const merged = { ...existing, ...validated };
    const msg = await checkContract({ ...validated, startDate: merged.startDate, endDate: merged.endDate }, orgId);
    if (msg) return fail(res, 400, msg);

    if (validated.status && validated.status !== existing.status) {
      if (!(CONTRACT_MOVES[existing.status ?? "draft"] ?? []).includes(validated.status)) {
        return fail(res, 409, `A ${existing.status} contract can't become ${validated.status}.`);
      }
    }
    if (["completed", "terminated"].includes(existing.status ?? "") && Object.keys(validated).length) {
      return fail(res, 409, `A ${existing.status} contract can't be changed.`);
    }
    const [contract] = await db
      .update(serviceContracts)
      .set({ ...validated, updatedAt: new Date() })
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

// DELETE /api/service-contracts/:id — only a draft can be deleted; a live or finished contract is a record.
serviceContractsRouter.delete("/:id", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    if (!isManagerRole(req.user.role)) return fail(res, 403, "Only an admin or manager can delete a service contract.");
    const orgId: number = req.user.organizationId;
    const id = parseInt(req.params.id);
    const found = await loadContract(id, orgId);
    if (!found) return res.status(404).json({ message: "Contract not found" });
    if (found.contract.status !== "draft") {
      return fail(res, 409, "Only a draft contract can be deleted. End an active contract by terminating it instead.");
    }
    await db.delete(serviceContracts).where(eq(serviceContracts.id, id));
    res.status(204).send();
  } catch (err) {
    console.error("Delete service contract error:", err);
    res.status(500).json({ message: "Failed to delete service contract" });
  }
});

// ─── Contractor Registry list (for contract form dropdowns) ─────────────────
// GET /api/contractors/registry  → this organisation's contractors, shaped for the dropdowns
// (it used to return every organisation's contractors, with their phone numbers and emails)

export const contractorRegistryListRouter = Router();

contractorRegistryListRouter.get("/", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    const rows = await db.select().from(contractors).where(eq(contractors.organizationId, req.user.organizationId));
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

// ─── Contractor portal invitations ───────────────────────────────────────────
// Adding a contractor with an email invites them to the contractor portal, the same way POST /api/users invites staff.
// The portal finds the contractor record by the login's email, so changing a contractor's email also invites the new
// address (otherwise the contractor silently loses their portal). The invite is issued only after the record has really
// been saved (a 2xx from the CRUD router mounted after this one), and the result is attached to the response so the
// manager can copy the link if the email could not be sent.

function inviteAfterSuccess(req: any, res: any, email: string) {
  const orgId: number = req.user.organizationId;
  const invitedBy: string = req.user.id;
  const send = res.json.bind(res);
  res.json = ((body: any) => {
    if (res.statusCode < 200 || res.statusCode >= 300) return send(body);
    (async () => {
      let invite: any = null;
      try {
        const issued = await issueInvite({ organizationId: orgId, invitedByUserId: invitedBy, email, role: "contractor" });
        const emailSent = issued.link ? await deliverInvite({ to: email, link: issued.link }) : false;
        invite = { status: issued.status, link: issued.link, emailSent };
      } catch (err: any) {
        // e.g. the email already belongs to an active account with another role:
        // the contractor record stays (it is useful without portal access) and
        // the response says why no portal invite went out.
        invite = { status: "active", link: null, emailSent: false, warning: err?.message ?? "Portal invite could not be created." };
      }
      send(body && typeof body === "object" && !Array.isArray(body) ? { ...body, invite } : body);
    })();
    return res;
  }) as any;
}

export const contractorCreateHookRouter = Router();

contractorCreateHookRouter.post("/", authenticateJWT, requireOrg, (req: any, res, next) => {
  const email: string | undefined = typeof req.body?.email === "string" ? req.body.email.trim() : undefined;
  if (!email) return next();
  inviteAfterSuccess(req, res, email);
  next();
});

// ─── Contractor record guard ─────────────────────────────────────────────────
// Sits in front of the generic create/update/delete for contractors. It stops the form (or anyone calling the API)
// from setting fields that are earned rather than typed (verified, rating, jobs done), from moving a contractor to
// another organisation, from reusing an email (the portal finds a contractor by email, so two records on one email
// would share one login), and from deleting a contractor that has work history.

export const contractorGuardRouter = Router();

const CONTRACTOR_HISTORY_TABLES = [
  "work_orders", "maintenance_requests", "property_expenses", "service_contracts", "contractor_reviews",
  "contractor_payments", "contractor_work_orders", "contractor_performance", "contractor_services",
  "service_schedules", "work_order_expenses", "managed_property_maintenance",
];

async function cleanContractorBody(req: any, res: any, partial: boolean, selfId?: number): Promise<boolean> {
  const b = req.body ?? (req.body = {});
  for (const k of ["id", "organizationId", "rating", "completedJobs", "createdAt", "updatedAt"]) delete b[k];
  // A manager registering an already-vetted contractor may say so; otherwise "verified" is only ever set by the verify action.
  if (partial || !isManagerRole(req.user.role)) delete b.isVerified;
  else if (b.isVerified !== undefined) b.isVerified = b.isVerified === true;
  const text = (k: string, label: string, max: number, required: boolean) => {
    if (b[k] === undefined && partial) return true;
    const v = String(b[k] ?? "").trim();
    if (!v && required) { fail(res, 400, `${label} is required.`); return false; }
    if (v.length > max) { fail(res, 400, `${label} is too long.`); return false; }
    b[k] = v || undefined;
    return true;
  };
  if (!text("name", "Contact name", 255, true) || !text("companyName", "Company name", 255, true) ||
      !text("phone", "Phone number", 50, true) || !text("specialty", "Specialty", 100, true)) return false;
  if (b.email !== undefined && b.email !== null && String(b.email).trim() !== "") {
    const email = String(b.email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) { fail(res, 400, "Enter a valid email address."); return false; }
    const [dup] = await db.select({ id: contractors.id }).from(contractors)
      .where(and(eq(contractors.organizationId, req.user.organizationId), sql`lower(${contractors.email}) = ${email}`)).limit(1);
    if (dup && dup.id !== selfId) { fail(res, 409, "Another contractor already uses that email."); return false; }
    b.email = email;
  } else if (b.email !== undefined) {
    b.email = null;
  }
  if (b.rate !== undefined && b.rate !== null && b.rate !== "") {
    const r = Number(b.rate);
    if (!isFinite(r) || r < 0 || r > MAX_MONEY) { fail(res, 400, "The rate must be a valid amount."); return false; }
  }
  return true;
}

contractorGuardRouter.post("/", authenticateJWT, requireOrg, async (req: any, res, next) => {
  try { if (await cleanContractorBody(req, res, false)) next(); }
  catch (err) { console.error("Contractor create guard error:", err); fail(res, 500, "Failed to save contractor"); }
});

const guardUpdate = async (req: any, res: any, next: any) => {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) return next();            // not a contractor id (e.g. /registry): leave it to its own route
    const [current] = await db.select({ id: contractors.id, email: contractors.email }).from(contractors)
      .where(and(eq(contractors.id, id), eq(contractors.organizationId, req.user.organizationId))).limit(1);
    if (!current) return fail(res, 404, "Not found");
    if (!(await cleanContractorBody(req, res, true, id))) return;
    const newEmail: string | null | undefined = req.body.email;
    if (newEmail && newEmail !== (current.email ?? "").toLowerCase()) inviteAfterSuccess(req, res, newEmail);
    next();
  } catch (err) { console.error("Contractor update guard error:", err); fail(res, 500, "Failed to save contractor"); }
};
contractorGuardRouter.put("/:id", authenticateJWT, requireOrg, guardUpdate);
contractorGuardRouter.patch("/:id", authenticateJWT, requireOrg, guardUpdate);

contractorGuardRouter.delete("/:id", authenticateJWT, requireOrg, async (req: any, res, next) => {
  try {
    if (!isManagerRole(req.user.role)) return fail(res, 403, "Only an admin or manager can remove a contractor.");
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) return next();
    const [current] = await db.select({ id: contractors.id }).from(contractors)
      .where(and(eq(contractors.id, id), eq(contractors.organizationId, req.user.organizationId))).limit(1);
    if (!current) return fail(res, 404, "Not found");
    for (const t of CONTRACTOR_HISTORY_TABLES) {
      const r: any = await db.execute(sql`select 1 from ${sql.identifier(t)} where contractor_id = ${id} limit 1`);
      if ((r.rows ?? r).length) {
        return fail(res, 409, "This contractor has work history (jobs, expenses or contracts), so it can't be deleted. Mark them as unavailable instead.", { code: "CONTRACTOR_HAS_HISTORY" });
      }
    }
    next();
  } catch (err) { console.error("Contractor delete guard error:", err); fail(res, 500, "Failed to remove contractor"); }
});

// ─── Contractor verify action ─────────────────────────────────────────────────

export const contractorVerifyRouter = Router();

// POST /api/contractors/:id/verify — admin or manager, and only for a contractor in their own organisation
// (it used to verify any contractor on the platform by id, for any signed-in staff member)
contractorVerifyRouter.post("/:id/verify", authenticateJWT, requireOrg, async (req: any, res) => {
  try {
    if (!isManagerRole(req.user.role)) return fail(res, 403, "Only an admin or manager can verify a contractor.");
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) return fail(res, 400, "Invalid contractor.");

    const [contractor] = await db
      .update(contractors)
      .set({ isVerified: true, updatedAt: new Date() })
      .where(and(eq(contractors.id, id), eq(contractors.organizationId, req.user.organizationId)))
      .returning();

    if (!contractor) return res.status(404).json({ message: "Contractor not found" });

    res.json(contractor);
  } catch (err) {
    console.error("Verify contractor error:", err);
    res.status(500).json({ message: "Failed to verify contractor" });
  }
});
