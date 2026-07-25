/**
 * Maintenance request action routes
 * (status transitions, technician assignment, comments, photos, feedback)
 */
import { Router } from "express";
import { db } from "../db";
import { maintenanceRequests, tenants, units, properties, staffMembers, users } from "@shared/schema";
import { eq, sql, and, desc } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import { auditLog } from "../middleware/auditLog";
import { storage } from "../storage";
import { z } from "zod";
import { notifyMaintenanceUpdated } from "../ws";
import { pushNotification } from "./notifications";
import { whatsappService } from "../whatsapp";
import { notifyTenant } from "../services/notifyTenant";
import { s3Upload, resolveUploadUrl } from "../middleware/s3Upload";

// Use the same S3/R2-backed upload middleware as documents and messages.
// Falls back to local disk automatically when S3 env vars are absent (dev mode).
const upload = s3Upload;

const router = Router();
router.use(authenticateJWT as any, requireOrg as any);

/** Fetch tenant phone for a maintenance request (returns null if unavailable) */
async function getTenantForRequest(requestId: number) {
  const [req] = await db
    .select({ tenantId: maintenanceRequests.tenantId })
    .from(maintenanceRequests)
    .where(eq(maintenanceRequests.id, requestId))
    .limit(1);
  if (!req?.tenantId) return null;

  const [tenant] = await db
    .select({
      firstName: tenants.firstName,
      lastName: tenants.lastName,
      phone: tenants.phone,
    })
    .from(tenants)
    .where(eq(tenants.id, req.tenantId))
    .limit(1);
  return tenant ?? null;
}

// PATCH /api/maintenance-requests/:id/assign-technician
router.patch("/:id/assign-technician", auditLog("maintenance_request", "ACTION"), async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const schema = z.object({
      technicianId: z.number().int().positive(),
      workStartTime: z.string().optional(),
      status: z.string().optional(),
    });
    const { technicianId, workStartTime, status } = schema.parse(req.body);

    const [existing] = await db
      .select({ createdAt: maintenanceRequests.createdAt })
      .from(maintenanceRequests)
      .where(eq(maintenanceRequests.id, id));

    if (!existing) return res.status(404).json({ message: "Maintenance request not found" });

    const assignmentTime = new Date();
    const responseTime = existing.createdAt
      ? Math.round((assignmentTime.getTime() - new Date(existing.createdAt).getTime()) / 60000)
      : 0;

    const [updated] = await db
      .update(maintenanceRequests)
      .set({
        technicianId,
        status: (status as any) ?? "assigned",
        responseTime,
        assignedDate: assignmentTime,
        ...(workStartTime ? { workStartTime: new Date(workStartTime) } : {}),
      })
      .where(eq(maintenanceRequests.id, id))
      .returning();

    notifyMaintenanceUpdated(req.user.organizationId, {
      id: updated.id,
      status: updated.status ?? "assigned",
      title: updated.title ?? undefined,
    });

    // Push targeted in-app notification to the assigned technician's user account
    try {
      const [staffRow] = await db
        .select({ email: staffMembers.email })
        .from(staffMembers)
        .where(eq(staffMembers.id, technicianId))
        .limit(1);

      if (staffRow?.email) {
        const [userRow] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, staffRow.email))
          .limit(1);

        if (userRow?.id) {
          notifyMaintenanceUpdated(req.user.organizationId, {
            id: updated.id,
            status: updated.status ?? "assigned",
            title: updated.title ?? undefined,
            assignedToUserId: userRow.id,
          });
          pushNotification(userRow.id, {
            type: "assignment",
            title: "New work order assigned to you",
            message: updated.title ?? `Ticket #${updated.id}`,
            ts: new Date().toISOString(),
            link: "/staff-portal",
            meta: { requestId: updated.id, status: updated.status, priority: (updated as any).priority },
          });
        }
      }
    } catch (notifErr) {
      console.warn("Could not push assignment notification:", notifErr);
    }

    // WhatsApp: notify tenant that a technician has been assigned
    try {
      const tenant = await getTenantForRequest(id);
      if (tenant?.phone) {
        const name = `${tenant.firstName} ${tenant.lastName}`.trim();
        await whatsappService.sendMaintenanceUpdate(
          tenant.phone,
          name,
          updated.ticketNumber,
          "Technician Assigned — we'll be in touch shortly",
          undefined,
          req.user.organizationId
        );
      }
      // Also fire the structured notifyTenant so in-app + prefs are respected
      if (updated.tenantId) {
        notifyTenant(updated.tenantId, {
          type: "maintenance_assigned",
          ticketNumber: updated.ticketNumber,
        }).catch(() => {});
      }
    } catch (waErr) {
      console.error("[WhatsApp] Assign notification failed (non-fatal):", waErr);
    }

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid data", errors: error.errors });
    }
    console.error("Assign technician error:", error);
    res.status(500).json({ message: "Failed to assign technician" });
  }
});

// PATCH /api/maintenance-requests/:id/complete
router.patch("/:id/complete", auditLog("maintenance_request", "ACTION"), async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const schema = z.object({
      workEndTime: z.string().optional(),
      technicianNotes: z.string().optional(),
      actualCost: z.string().optional(),
      totalTimeSpent: z.number().optional(),
    });
    const data = schema.parse(req.body);

    const [updated] = await db
      .update(maintenanceRequests)
      .set({
        status: "completed",
        completedAt: new Date(),
        ...(data.workEndTime ? { workEndTime: new Date(data.workEndTime) } : {}),
        ...(data.technicianNotes ? { technicianNotes: data.technicianNotes } : {}),
        ...(data.actualCost ? { actualCost: data.actualCost } : {}),
        ...(data.totalTimeSpent != null ? { totalTimeSpent: data.totalTimeSpent } : {}),
      })
      .where(eq(maintenanceRequests.id, id))
      .returning();

    if (!updated) return res.status(404).json({ message: "Maintenance request not found" });

    notifyMaintenanceUpdated(req.user.organizationId, {
      id: updated.id,
      status: "completed",
      title: updated.title ?? undefined,
    });

    // WhatsApp: notify tenant that work is complete
    try {
      const tenant = await getTenantForRequest(id);
      if (tenant?.phone) {
        const name = `${tenant.firstName} ${tenant.lastName}`.trim();
        await whatsappService.sendMaintenanceUpdate(
          tenant.phone,
          name,
          updated.ticketNumber,
          "Completed ✅ — please let us know if everything is in order",
          undefined,
          req.user.organizationId
        );
      }
      if (updated.tenantId) {
        notifyTenant(updated.tenantId, {
          type: "maintenance_completed",
          ticketNumber: updated.ticketNumber,
        }).catch(() => {});
      }
    } catch (waErr) {
      console.error("[WhatsApp] Completion notification failed (non-fatal):", waErr);
    }

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid data", errors: error.errors });
    }
    console.error("Complete maintenance error:", error);
    res.status(500).json({ message: "Failed to complete maintenance request" });
  }
});

// PATCH /api/maintenance-requests/:id/feedback
router.patch("/:id/feedback", auditLog("maintenance_request", "ACTION"), async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const orgId: number = req.user.organizationId;
    const role: string  = req.user.role ?? "";

    const [existing] = await db
      .select({ id: maintenanceRequests.id, tenantId: maintenanceRequests.tenantId, organizationId: maintenanceRequests.organizationId })
      .from(maintenanceRequests)
      .where(eq(maintenanceRequests.id, id))
      .limit(1);

    if (!existing || existing.organizationId !== orgId) {
      return res.status(404).json({ message: "Maintenance request not found" });
    }

    // A tenant may only leave feedback on their OWN maintenance request.
    if (role === "tenant") {
      const [own] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.userId, req.user.id)).limit(1);
      if (!own || existing.tenantId !== own.id) {
        return res.status(404).json({ message: "Maintenance request not found" });
      }
    }

    const schema = z.object({
      rating: z.number().int().min(1).max(5),
      comments: z.string().optional(),
    });
    const { rating, comments } = schema.parse(req.body);

    const [updated] = await db
      .update(maintenanceRequests)
      .set({
        satisfactionRating: rating,
        satisfactionComments: comments,
        feedbackDate: new Date(),
      })
      .where(eq(maintenanceRequests.id, id))
      .returning();

    if (!updated) return res.status(404).json({ message: "Maintenance request not found" });
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: "Invalid data", errors: error.errors });
    }
    console.error("Feedback error:", error);
    res.status(500).json({ message: "Failed to submit feedback" });
  }
});

// GET /api/maintenance-requests/:id/comments
router.get("/:id/comments", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
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

    const request = await storage.getMaintenanceRequest(id);
    if (!request) return res.status(404).json({ message: "Request not found" });

    let comments: any[] = [];
    try {
      comments = request.internalNotes ? JSON.parse(request.internalNotes) : [];
    } catch {
      comments = [];
    }

    const newComment = {
      id: Date.now(),
      authorId: req.user.id,
      authorName: `${req.user.firstName ?? ""} ${req.user.lastName ?? ""}`.trim() || "Unknown",
      content: content.trim(),
      createdAt: new Date().toISOString(),
      isTechnician: req.user.role === "technician",
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
router.get("/:id/photos", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
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

// POST /api/maintenance-requests/:id/photos
router.post("/:id/photos", authenticateJWT, upload.single("photo"), auditLog("maintenance_photo", "CREATE"), async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!req.file) return res.status(400).json({ message: "No photo uploaded" });

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
// Returns all requests where approvalRequired=true, joined with tenant/unit/property
router.get("/approvals", async (req: any, res) => {
  try {
    const orgId = req.user?.organizationId || req.session?.organizationId;

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
      .leftJoin(tenants, eq(maintenanceRequests.tenantId, tenants.id))
      .leftJoin(units, eq(maintenanceRequests.unitId, units.id))
      .leftJoin(properties, eq(units.propertyId, properties.id))
      .where(
        orgId
          ? and(eq(maintenanceRequests.approvalRequired, true), eq(tenants.organizationId, orgId))
          : eq(maintenanceRequests.approvalRequired, true)
      )
      .orderBy(desc(maintenanceRequests.createdAt));

    const results = rows.map(r => ({
      id: r.id,
      ticketNumber: r.ticketNumber,
      title: r.title,
      description: r.description,
      priority: r.priority,
      status: r.status,
      approvalRequired: r.approvalRequired,
      approval_status: r.approvedBy
        ? (r.rejectionReason ? "rejected" : "approved")
        : "pending",
      estimatedCost: r.estimatedCost,
      actualCost: r.actualCost,
      category: r.category,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
      tenantName: (r.tenantFirstName || r.tenantLastName)
        ? `${r.tenantFirstName ?? ""} ${r.tenantLastName ?? ""}`.trim()
        : null,
      propertyName: r.propertyName ?? null,
      unitNumber: r.unitNumber ?? null,
    }));

    res.json(results);
  } catch (err) {
    console.error("Get approvals error:", err);
    res.status(500).json({ message: "Failed to fetch approvals" });
  }
});

// POST /api/maintenance-requests/:id/approve
router.post("/:id/approve", auditLog("maintenance_request", "ACTION"), async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const schema = z.object({
      approvalStatus: z.enum(["approved", "rejected"]),
      comments: z.string().optional(),
      approvedAmount: z.number().optional(),
    });
    const { approvalStatus, comments, approvedAmount } = schema.parse(req.body);

    const orgId: number = req.user.organizationId;
    // Verify the request belongs to this org via units join
    const [existing] = await db
      .select({ id: maintenanceRequests.id })
      .from(maintenanceRequests)
      .innerJoin(units, eq(maintenanceRequests.unitId, units.id))
      .where(and(eq(maintenanceRequests.id, id), eq(units.organizationId, orgId)))
      .limit(1);

    if (!existing) return res.status(404).json({ message: "Maintenance request not found" });

    const updateData: Record<string, any> = {
      approvedBy: approvalStatus === "approved" ? req.user.id : null,
      approvedDate: approvalStatus === "approved" ? new Date() : null,
      rejectionReason: approvalStatus === "rejected" ? (comments ?? "Rejected") : null,
      internalNotes: comments ?? null,
    };
    if (approvedAmount != null) {
      updateData.estimatedCost = String(approvedAmount);
    }

    const [updated] = await db
      .update(maintenanceRequests)
      .set(updateData)
      .where(eq(maintenanceRequests.id, id))
      .returning();

    notifyMaintenanceUpdated(req.user.organizationId, {
      id: updated.id,
      status: updated.status ?? "pending",
      title: updated.title ?? undefined,
    });

    // WhatsApp: notify tenant of rejection
    if (approvalStatus === "rejected") {
      try {
        const tenant = await getTenantForRequest(id);
        if (tenant?.phone) {
          await whatsappService.sendMaintenanceUpdate(
            tenant.phone,
            `${tenant.firstName} ${tenant.lastName}`.trim(),
            updated.ticketNumber,
            "could not be approved at this time",
            undefined,
            req.user.organizationId
          );
        }
        if (updated.tenantId) {
          notifyTenant(updated.tenantId, {
            type: "maintenance_rejected",
            ticketNumber: updated.ticketNumber,
            reason: comments,
          }).catch(() => {});
        }
      } catch (waErr) {
        console.error("[WhatsApp] Rejection notification failed (non-fatal):", waErr);
      }
    }

    res.json({ message: `Request ${approvalStatus}`, request: updated });
  } catch (err) {
    console.error("Approve error:", err);
    res.status(500).json({ message: "Failed to process approval" });
  }
});