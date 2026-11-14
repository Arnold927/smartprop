/**
 * Maintenance request action routes
 * (status transitions, technician assignment, comments, photos, feedback)
 */
import { Router } from "express";
import { db } from "../db";
import { maintenanceRequests, tenants, units, properties, staffMembers, users, contractors, documents } from "@shared/schema";
import { eq, sql, and, desc, or } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import { auditLog } from "../middleware/auditLog";
import { storage } from "../storage";
import { z } from "zod";
import { s3Upload, resolveUploadUrl } from "../middleware/s3Upload";
import { resolveScopedRequest, callerCanAccess } from "./maintenance-item-guard";
import { landlordStaffPrefix } from "./assignable-staff";
import {
  transition, rateRequest, setTenantCharge, actorFromReq, contractorUserId, WorkflowError,
  type WorkflowAction,
} from "../services/maintenance-workflow";

// Use the same S3/R2-backed upload middleware as documents and messages.
// Falls back to local disk automatically when S3 env vars are absent (dev mode).
const upload = s3Upload;

const router = Router();
router.use(authenticateJWT as any, requireOrg as any);

/** Every workflow route answers the same way: the updated request, or { message, code } with the right status. */
function fail(res: any, err: any, what: string) {
  if (err instanceof WorkflowError) return res.status(err.httpStatus).json({ message: err.message, code: err.code });
  if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0]?.message ?? "Invalid data", errors: err.errors });
  console.error(`[maintenance] ${what}:`, err);
  return res.status(500).json({ message: `Failed to ${what}` });
}

const idOf = (req: any) => Number(req.params.id);

// PATCH /api/maintenance-requests/:id/assign-technician
//   { technicianId }   hand the job to an in-house technician (or null = take them off, back to pending)
//   { contractorId }   hand the job to an external contractor — they get it as a work order in their portal
router.patch("/:id/assign-technician", auditLog("maintenance_request", "ACTION"), async (req: any, res) => {
  try {
    const id = idOf(req);
    if (!Number.isInteger(id)) return res.status(404).json({ message: "Maintenance request not found" });
    const schema = z.object({
      technicianId: z.number().int().positive().nullable().optional(),
      contractorId: z.number().int().positive().optional(),
      scheduledDate: z.string().optional(),
      estimatedCost: z.string().optional(),
    }).refine((v) => v.technicianId !== undefined || v.contractorId !== undefined, { message: "Choose a technician or a contractor." });
    const body = schema.parse(req.body);
    const actor = actorFromReq(req);
    const org = req.user.organizationId;

    if (body.technicianId === null) {
      return res.json(await transition(id, "unassign", actor));
    }

    if (body.contractorId !== undefined) {
      const [c] = await db.select().from(contractors).where(and(eq(contractors.id, body.contractorId), eq(contractors.organizationId, org))).limit(1);
      if (!c) return res.status(404).json({ message: "Contractor not found in your organisation" });
      if (c.isAvailable === false) return res.status(409).json({ message: `${c.name || c.companyName} is marked unavailable.` });
      const userId = await contractorUserId(c.email, org);
      return res.json(await transition(id, "assign", actor, {
        contractor: { id: c.id, name: c.name || c.companyName, userId },
        scheduledDate: body.scheduledDate, estimatedCost: body.estimatedCost,
      }));
    }

    const [technician] = await db
      .select({ id: staffMembers.id, email: staffMembers.email, employeeId: staffMembers.employee_id, first: staffMembers.first_name, last: staffMembers.last_name })
      .from(staffMembers)
      .where(and(eq(staffMembers.id, body.technicianId!), eq(staffMembers.organization_id, org)))
      .limit(1);
    if (!technician) return res.status(404).json({ message: "Staff member not found in your organisation" });
    // A landlord can hand work to the manager's staff and to people they added — not to another landlord's.
    if (req.user.role === "landlord" && technician.employeeId.startsWith("LL-") && !technician.employeeId.startsWith(landlordStaffPrefix(req.user.id))) {
      return res.status(404).json({ message: "Staff member not found in your organisation" });
    }
    // The technician's own portal finds its work by user id (assignedTo) or staff id (technicianId): set both.
    let userId: string | null = null;
    if (technician.email) {
      const [u] = await db.select({ id: users.id }).from(users)
        .where(and(sql`lower(${users.email}) = lower(${technician.email})`, eq(users.organizationId, org))).limit(1);
      userId = u?.id ?? null;
    }
    res.json(await transition(id, "assign", actor, {
      technician: { id: technician.id, userId, name: `${technician.first} ${technician.last}`.trim() },
      scheduledDate: body.scheduledDate, estimatedCost: body.estimatedCost,
    }));
  } catch (err) { fail(res, err, "assign the request"); }
});

// The simple one-click actions. Role rules, valid states, timestamps and notifications all live in the workflow service.
for (const action of ["start", "pause", "complete", "cancel", "reopen"] as const) {
  router.patch(`/:id/${action}`, auditLog("maintenance_request", "ACTION"), async (req: any, res) => {
    try {
      const id = idOf(req);
      if (!Number.isInteger(id)) return res.status(404).json({ message: "Maintenance request not found" });
      const b = z.object({
        reason: z.string().trim().max(1000).optional(),
        technicianNotes: z.string().max(5000).optional(),
        actualCost: z.union([z.string(), z.number()]).optional(),
        totalTimeSpent: z.number().optional(),
        workEndTime: z.string().optional(),
      }).parse(req.body ?? {});
      if (action === "reopen" && !b.reason) return res.status(400).json({ message: "Tell us what's still wrong so we can follow up." });
      res.json(await transition(id, action as WorkflowAction, actorFromReq(req), {
        reason: b.reason, technicianNotes: b.technicianNotes,
        actualCost: b.actualCost != null ? String(b.actualCost) : undefined, totalTimeSpent: b.totalTimeSpent,
      }));
    } catch (err) { fail(res, err, `${action} the request`); }
  });
}

// PATCH /api/maintenance-requests/:id/feedback — the tenant rates a completed request (once). See also POST /api/ratings/maintenance.
router.patch("/:id/feedback", auditLog("maintenance_request", "ACTION"), async (req: any, res) => {
  try {
    const id = idOf(req);
    if (!Number.isInteger(id)) return res.status(404).json({ message: "Maintenance request not found" });
    const { rating, comments } = z.object({ rating: z.number().int().min(1).max(5), comments: z.string().trim().max(2000).optional() }).parse(req.body);
    res.json(await rateRequest(id, actorFromReq(req), { rating, comments }));
  } catch (err) { fail(res, err, "submit feedback"); }
});

// PATCH /api/maintenance-requests/:id/charge — charge the repair to the tenant (or take the charge off).
// Body: { charge: boolean, amount?: number, reason?: string }. Billing happens when the job is completed
// (immediately if it already is). Managers/admins and the property's own landlord only.
router.patch("/:id/charge", auditLog("maintenance_request", "ACTION"), async (req: any, res) => {
  try {
    const id = idOf(req);
    if (!Number.isInteger(id)) return res.status(404).json({ message: "Maintenance request not found" });
    const body = z.object({
      charge: z.boolean(),
      amount: z.union([z.number(), z.string()]).nullish(),
      reason: z.string().trim().max(500).nullish(),
    }).parse(req.body);
    res.json(await setTenantCharge(id, actorFromReq(req), body));
  } catch (err) { fail(res, err, "update the tenant charge"); }
});

// GET /api/maintenance-requests/:id/comments
router.get("/:id/comments", async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);

    // Previously zero scoping — any authenticated user, from any
    // organisation, could read any maintenance request's comments. Tenants
    // ARE allowed here (unlike assign-technician/complete above), but only
    // for their own request — callerCanAccess already enforces that.
    const scoped = await resolveScopedRequest(id, req.user.organizationId);
    if (!scoped || !(await callerCanAccess(scoped, req))) {
      return res.status(404).json({ message: "Request not found" });
    }

    const request = await storage.getMaintenanceRequest(id);
    if (!request) return res.status(404).json({ message: "Request not found" });

    let comments: any[] = [];
    try {
      comments = request.internalNotes ? JSON.parse(request.internalNotes) : [];
    } catch {
      comments = [];
    }
    res.json(comments);
  } catch (error) {
    console.error("Get comments error:", error);
    res.status(500).json({ message: "Failed to fetch comments" });
  }
});

// POST /api/maintenance-requests/:id/comments
router.post("/:id/comments", auditLog("maintenance_comment", "CREATE"), async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ message: "Comment content is required" });

    // Same scoping as GET /:id/comments above.
    const scoped = await resolveScopedRequest(id, req.user.organizationId);
    if (!scoped || !(await callerCanAccess(scoped, req))) {
      return res.status(404).json({ message: "Request not found" });
    }

    const request = await storage.getMaintenanceRequest(id);
    if (!request) return res.status(404).json({ message: "Request not found" });

    let comments: any[] = [];
    try {
      comments = request.internalNotes ? JSON.parse(request.internalNotes) : [];
    } catch {
      comments = [];
    }

    // req.user.role can never be "technician" — that's a staffMembers.position
    // value (an HR job title), not a users.role value, so this always
    // evaluated to false regardless of who was actually commenting. Resolve
    // it properly via the same email-match pattern used to link a login
    // account to its staffMembers HR record elsewhere in this app.
    let isTechnician = false;
    if (req.user.email) {
      const [staffRow] = await db
        .select({ position: staffMembers.position })
        .from(staffMembers)
        .where(and(eq(staffMembers.email, req.user.email), eq(staffMembers.organization_id, req.user.organizationId)))
        .limit(1);
      isTechnician = staffRow?.position === "technician";
    }

    const newComment = {
      id: Date.now(),
      authorId: req.user.id,
      authorName: `${req.user.firstName ?? ""} ${req.user.lastName ?? ""}`.trim() || "Unknown",
      content: content.trim(),
      createdAt: new Date().toISOString(),
      isTechnician,
    };

    comments.push(newComment);
    await storage.updateMaintenanceRequest(id, { internalNotes: JSON.stringify(comments) });

    res.status(201).json(newComment);
  } catch (error) {
    console.error("Add comment error:", error);
    res.status(500).json({ message: "Failed to add comment" });
  }
});

// GET /api/maintenance-requests/:id/photos
router.get("/:id/photos", async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);

    // Previously zero scoping — any authenticated user, from any
    // organisation, could view any maintenance request's photos.
    const scoped = await resolveScopedRequest(id, req.user.organizationId);
    if (!scoped || !(await callerCanAccess(scoped, req))) {
      return res.status(404).json({ message: "Request not found" });
    }

    const request = await storage.getMaintenanceRequest(id);
    if (!request) return res.status(404).json({ message: "Request not found" });

    // Get photos from the complaintsPhotos table
    const photos = await storage.getComplaintPhotos(id);
    res.json(photos.map(photo => ({
      id: photo.id,
      url: photo.url, // The field is 'url', not 'photoUrl'
      uploadedBy: photo.uploadedBy, // The field is 'uploadedBy', not 'userId'
      uploadedAt: photo.createdAt,
    })));
  } catch (error) {
    console.error("Get photos error:", error);
    res.status(500).json({ message: "Failed to fetch photos" });
  }
});

// GET /api/maintenance-requests/:id/documents
// The detail page asks for attachments here; the route did not exist, so every
// request-detail page load produced a 404. Same org + role scoping as /photos.
router.get("/:id/documents", async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid id" });

    const scoped = await resolveScopedRequest(id, req.user.organizationId);
    if (!scoped || !(await callerCanAccess(scoped, req))) {
      return res.status(404).json({ message: "Request not found" });
    }

    const rows = await db
      .select({
        id: documents.id,
        name: documents.name,
        type: documents.type,
        url: documents.url,
        size: documents.size,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .where(eq(documents.maintenanceRequestId, id))
      .orderBy(desc(documents.createdAt));
    res.json(rows);
  } catch (error) {
    console.error("Get maintenance documents error:", error);
    res.status(500).json({ message: "Failed to fetch documents" });
  }
});

// POST /api/maintenance-requests/:id/photos
router.post("/:id/photos", authenticateJWT, upload.single("photo"), auditLog("maintenance_photo", "CREATE"), async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!req.file) return res.status(400).json({ message: "No photo uploaded" });

    // Same scoping as GET /:id/photos above.
    const scoped = await resolveScopedRequest(id, req.user.organizationId);
    if (!scoped || !(await callerCanAccess(scoped, req))) {
      return res.status(404).json({ message: "Request not found" });
    }

    const request = await storage.getMaintenanceRequest(id);
    if (!request) return res.status(404).json({ message: "Request not found" });

    // Create photo entry in complaintsPhotos table
    // The correct field names are: url, uploadedBy (not photoUrl, userId)
    const photo = await storage.createComplaintPhoto({
      maintenanceRequestId: id,
      url: resolveUploadUrl(req.file as any), // Use 'url' field
      uploadedBy: req.user.id, // Use 'uploadedBy' field
      fileName: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mimeType: req.file.mimetype,
    } as any); // Use type assertion to bypass strict type checking

    const photoEntry = {
      id: photo.id,
      url: photo.url,
      uploadedBy: photo.uploadedBy,
      uploadedAt: photo.createdAt,
    };

    res.status(201).json(photoEntry);
  } catch (error) {
    console.error("Upload photo error:", error);
    res.status(500).json({ message: "Failed to upload photo" });
  }
});

export default router;

// GET /api/maintenance-requests/approvals
// The approval queue: requests that needed sign-off (cost above the property's PM-agreement threshold),
// waiting ones first, then the decided ones. Landlords see only their own properties.
router.get("/approvals", async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    const role: string = req.user?.role ?? "";
    if (!["platform_admin", "admin", "manager", "landlord"].includes(role)) {
      return res.status(403).json({ message: "Only managers and property owners handle approvals." });
    }
    const conditions = [
      eq(units.organizationId, orgId),
      or(eq(maintenanceRequests.approvalRequired, true), eq(maintenanceRequests.status, "pending_approval")),
    ];
    if (role === "landlord") conditions.push(eq(properties.ownerId, String(req.user.id)));

    const rows = await db
      .select({
        id: maintenanceRequests.id,
        ticketNumber: maintenanceRequests.ticketNumber,
        title: maintenanceRequests.title,
        description: maintenanceRequests.description,
        priority: maintenanceRequests.priority,
        status: maintenanceRequests.status,
        approvalRequired: maintenanceRequests.approvalRequired,
        approvedBy: maintenanceRequests.approvedBy,
        approvedDate: maintenanceRequests.approvedDate,
        rejectionReason: maintenanceRequests.rejectionReason,
        estimatedCost: maintenanceRequests.estimatedCost,
        actualCost: maintenanceRequests.actualCost,
        currency: maintenanceRequests.currency,
        category: maintenanceRequests.category,
        createdAt: maintenanceRequests.createdAt,
        completedAt: maintenanceRequests.completedAt,
        tenantFirstName: tenants.firstName,
        tenantLastName: tenants.lastName,
        tenantEmail: tenants.email,
        unitNumber: units.unitNumber,
        propertyName: properties.name,
      })
      .from(maintenanceRequests)
      .innerJoin(units, eq(maintenanceRequests.unitId, units.id))
      .leftJoin(tenants, eq(maintenanceRequests.tenantId, tenants.id))
      .leftJoin(properties, eq(units.propertyId, properties.id))
      .where(and(...conditions))
      .orderBy(desc(maintenanceRequests.createdAt));

    const results = rows.map((r) => {
      const approval_status =
        r.status === "pending_approval" ? "pending"
        : r.rejectionReason ? "rejected"
        : "approved";
      return {
        id: r.id, ticketNumber: r.ticketNumber, title: r.title, description: r.description,
        priority: r.priority, status: r.status, approvalRequired: r.approvalRequired, approval_status,
        rejectionReason: r.rejectionReason, approvedDate: r.approvedDate,
        estimatedCost: r.estimatedCost, actualCost: r.actualCost, currency: r.currency, category: r.category,
        createdAt: r.createdAt, completedAt: r.completedAt,
        tenantName: (r.tenantFirstName || r.tenantLastName) ? `${r.tenantFirstName ?? ""} ${r.tenantLastName ?? ""}`.trim() : null,
        propertyName: r.propertyName ?? null, unitNumber: r.unitNumber ?? null,
      };
    });
    // Waiting first (oldest first, so nothing sits), then decided (newest first).
    results.sort((a, b) =>
      (a.approval_status === "pending" ? 0 : 1) - (b.approval_status === "pending" ? 0 : 1)
      || (a.approval_status === "pending"
        ? +new Date(a.createdAt ?? 0) - +new Date(b.createdAt ?? 0)
        : +new Date(b.createdAt ?? 0) - +new Date(a.createdAt ?? 0)));
    res.json(results);
  } catch (err) {
    console.error("Get approvals error:", err);
    res.status(500).json({ message: "Failed to fetch approvals" });
  }
});

// POST /api/maintenance-requests/:id/approve — approve or reject a request that is waiting for sign-off.
// Only admins, managers and the property's owner may decide; the tenant (who raised it) never can.
router.post("/:id/approve", auditLog("maintenance_request", "ACTION"), async (req: any, res) => {
  try {
    const id = idOf(req);
    if (!Number.isInteger(id)) return res.status(404).json({ message: "Maintenance request not found" });
    const { approvalStatus, comments, approvedAmount } = z.object({
      approvalStatus: z.enum(["approved", "rejected"]),
      comments: z.string().trim().max(2000).optional(),
      approvedAmount: z.number().nonnegative().optional(),
    }).parse(req.body);
    if (approvalStatus === "rejected" && !comments) return res.status(400).json({ message: "Give a reason so the tenant knows why." });
    const updated = await transition(id, approvalStatus === "approved" ? "approve" : "reject", actorFromReq(req), { comments, reason: comments, approvedAmount });
    res.json({ message: `Request ${approvalStatus}`, request: updated });
  } catch (err) { fail(res, err, "process the approval"); }
});
