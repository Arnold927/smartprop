/**
 * server/routes/assignable-staff.ts   (mounted at /api/assignable-staff)
 *
 * Who a maintenance request can be handed to, and how a landlord adds their own people.
 *
 *  GET  /api/assignable-staff   Every active staff member the caller may assign work to — NOT only
 *                               "maintenance department" staff (that filter hid most of an
 *                               organisation's people from the dropdowns). Minimal fields only:
 *                               no salary / HR data, so landlords can safely use it.
 *  POST /api/assignable-staff   A landlord (or admin/manager) adds a technician / team member.
 *
 * Landlords share an organisation with a property manager's staff and with other landlords:
 *   - they can assign any of the manager's own staff and the people THEY added, never another
 *     landlord's people;
 *   - the portal login a landlord gives someone is a property-scoped CARETAKER login for one of the
 *     landlord's own properties. The "staff" login role is organisation-wide (every landlord's
 *     properties, tenants and rent), so a landlord can never hand that out — the property manager
 *     does that from the Staff page.
 * People a landlord adds carry an employee id starting "LL-<their user id prefix>-" so ownership
 * needs no schema change.
 */

import { Router } from "express";
import { randomInt } from "crypto";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { staffMembers, properties, positionEnum, departmentEnum } from "@shared/schema";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import { storage } from "../storage";
import { resolveOrInviteCaretakerUser } from "../utils/resolveOrInviteCaretakerUser";
import { inviteStaffUser } from "../utils/inviteStaffUser";
import { InviteConflictError } from "../utils/invites";

const router = Router();
router.use(authenticateJWT as any, requireOrg as any);

const MAINTENANCE_POSITIONS = ["technician", "maintenance_supervisor", "facilities_manager", "groundskeeper", "janitor"];

/** Prefix that marks a person as added by one particular landlord. */
export const landlordStaffPrefix = (userId: string) => `LL-${userId.replace(/-/g, "").slice(0, 8)}-`;

function departmentFor(position: string): (typeof departmentEnum.enumValues)[number] {
  if (MAINTENANCE_POSITIONS.includes(position)) return "maintenance";
  if (["security_guard", "concierge"].includes(position)) return "security";
  if (["accountant", "accounts_receivable", "accounts_payable"].includes(position)) return "finance";
  if (position === "marketing_specialist") return "marketing";
  if (position === "hr_manager") return "hr";
  if (["administrative_assistant", "it_specialist"].includes(position)) return "administration";
  return "property_management";
}

// ── GET /api/assignable-staff ──────────────────────────────────────────────────────────────────
router.get("/", async (req: any, res: any) => {
  try {
    const orgId: number = req.user.organizationId;
    const role: string = req.user.role;
    const mine = role === "landlord" ? landlordStaffPrefix(req.user.id) : null;

    const rows = await db
      .select({
        id: staffMembers.id,
        firstName: staffMembers.first_name,
        lastName: staffMembers.last_name,
        position: staffMembers.position,
        department: staffMembers.department,
        phone: staffMembers.phone,
        employeeId: staffMembers.employee_id,
        status: staffMembers.status,
      })
      .from(staffMembers)
      .where(and(eq(staffMembers.organization_id, orgId), eq(staffMembers.status, "active")));

    const out = rows
      .filter((r) => {
        if (!mine) return true;
        // A landlord sees the manager's staff and their own people — never another landlord's.
        return !r.employeeId.startsWith("LL-") || r.employeeId.startsWith(mine);
      })
      .map((r) => {
        const addedByLandlord = r.employeeId.startsWith("LL-");
        return {
          id: r.id,
          firstName: r.firstName,
          lastName: r.lastName,
          position: r.position,
          department: r.department,
          addedByLandlord,
          mine: !!mine && r.employeeId.startsWith(mine),
          isMaintenance: r.department === "maintenance" || MAINTENANCE_POSITIONS.includes(String(r.position)),
          // Contact number only for people the caller added / for the organisation's own team.
          phone: role === "landlord" && !(mine && r.employeeId.startsWith(mine)) ? null : r.phone,
        };
      })
      .sort((a, b) =>
        Number(b.isMaintenance) - Number(a.isMaintenance) ||
        `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`),
      );

    res.json(out);
  } catch (err) {
    console.error("GET /api/assignable-staff error:", err);
    res.status(500).json({ message: "Failed to load staff" });
  }
});

// ── POST /api/assignable-staff ─────────────────────────────────────────────────────────────────
const addSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(100),
  lastName: z.string().trim().min(1, "Last name is required").max(100),
  phone: z.string().trim().max(50).optional().default(""),
  email: z.string().trim().toLowerCase().email("Enter a valid email").optional().or(z.literal("")),
  position: z.enum(positionEnum.enumValues as [string, ...string[]]).default("technician"),
  /** Own property the person works at — required when they should get a portal login. */
  propertyId: z.coerce.number().int().positive().optional(),
  giveAccess: z.boolean().optional().default(false),
});

router.post("/", async (req: any, res: any) => {
  const role: string = req.user.role;
  if (!["landlord", "admin", "manager"].includes(role)) {
    return res.status(403).json({ message: "Not permitted." });
  }
  const parsed = addSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid details", errors: parsed.error.flatten().fieldErrors });
  }
  const d = parsed.data;
  const email = d.email || "";
  if (!d.phone && !email) {
    return res.status(400).json({ message: "Add a phone number or an email so the work can reach them." });
  }
  const orgId: number = req.user.organizationId;

  try {
    // Portal access: landlord → caretaker login on one of THEIR properties; admin/manager → normal staff login.
    let propertyId: number | undefined;
    if (d.giveAccess && !email) {
      return res.status(400).json({ message: "An email is needed to give portal access." });
    }
    if (role === "landlord" && d.giveAccess) {
      if (!d.propertyId) return res.status(400).json({ message: "Choose the property they will work at." });
    }
    if (d.propertyId) {
      const cond = role === "landlord"
        ? and(eq(properties.id, d.propertyId), eq(properties.organizationId, orgId), eq(properties.ownerId, req.user.id))
        : and(eq(properties.id, d.propertyId), eq(properties.organizationId, orgId));
      const [prop] = await db.select({ id: properties.id }).from(properties).where(cond).limit(1);
      if (!prop) return res.status(404).json({ message: "Property not found." });
      propertyId = prop.id;
    }

    if (email) {
      const [dupe] = await db
        .select({ id: staffMembers.id })
        .from(staffMembers)
        .where(and(eq(staffMembers.organization_id, orgId), eq(staffMembers.email, email)))
        .limit(1);
      if (dupe) return res.status(409).json({ message: `${email} is already on the team list.` });
    }

    const employeeId = role === "landlord"
      ? `${landlordStaffPrefix(req.user.id)}${randomInt(1000, 9999)}`
      : `STF-${Date.now().toString(36).toUpperCase()}${randomInt(10, 99)}`;

    const [created] = await db
      .insert(staffMembers)
      .values({
        organization_id: orgId,
        employee_id: employeeId,
        first_name: d.firstName,
        last_name: d.lastName,
        email: email || null,
        phone: d.phone || null,
        position: d.position as any,
        department: departmentFor(d.position),
        employment_type: "contract",
        hire_date: new Date(),
        status: "active",
      } as any)
      .returning();

    let invite: any = null;
    if (d.giveAccess && email) {
      try {
        if (role === "landlord") {
          const r = await resolveOrInviteCaretakerUser({
            organizationId: orgId,
            invitedByUserId: req.user.id,
            email,
            firstName: d.firstName,
            lastName: d.lastName,
          });
          await storage.createCaretaker({
            userId: r.userId,
            propertyId: propertyId!,
            caretakerType: "technician",
            contactNumber: d.phone || null,
            status: "active",
          } as any);
          invite = r.invite;
        } else {
          invite = await inviteStaffUser({
            organizationId: orgId,
            invitedByUserId: req.user.id,
            email,
            firstName: d.firstName,
            lastName: d.lastName,
            position: d.position,
          });
        }
      } catch (e: any) {
        if (e instanceof InviteConflictError) {
          invite = { status: "active", link: null, emailSent: false, warning: e.message };
        } else {
          console.warn("[assignable-staff] portal invite failed:", e);
          invite = { status: "active", link: null, emailSent: false, warning: "The person was added, but their portal login could not be created." };
        }
      }
    }

    res.status(201).json({
      id: created.id,
      firstName: created.first_name,
      lastName: created.last_name,
      position: created.position,
      department: created.department,
      invite,
    });
  } catch (err) {
    console.error("POST /api/assignable-staff error:", err);
    res.status(500).json({ message: "Failed to add this person" });
  }
});

export default router;
