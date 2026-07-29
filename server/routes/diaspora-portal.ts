/**
 * diaspora-portal.ts — mounted at /api/diaspora-portal
 *
 * Read-only, buyer-scoped endpoints that power the DiasporaBuyerPortal
 * frontend page.  Every response is filtered to contracts where
 * buyerUserId = req.user.id — a buyer can never see another buyer's data.
 *
 * Allowed roles: all authenticated users (ALL_AUTHENTICATED in ROUTE_POLICY).
 * In practice, buyers are created (or linked) with role='tenant' — see
 * diaspora.ts's contract-creation flow. Anyone else simply gets an empty list.
 *
 * Endpoints:
 *   GET /api/diaspora-portal/contracts           — buyer's contracts
 *   GET /api/diaspora-portal/contracts/:id       — single contract (must belong to buyer)
 *   GET /api/diaspora-portal/contracts/:id/payments       — payment history
 *   GET /api/diaspora-portal/contracts/:id/construction   — construction photo updates
 *   GET /api/diaspora-portal/contracts/:id/certificates   — digital certificates
 *   GET /api/diaspora-portal/contracts/:id/schedule       — upcoming payment schedule
 */

import { Router } from "express";
import { db } from "../db";
import {
  diasporaContracts,
  diasporaPayments,
  constructionUpdates,
  diasporaCertificates,
  diasporaPaymentSchedule,
  properties,
} from "@shared/schema";
import { eq, and, asc, desc } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import { logger } from "../lib/logger";

const router = Router();
const auth = [authenticateJWT as any, requireOrg as any];

// ── Helper: verify contract belongs to this buyer ─────────────────────────────
async function getBuyerContract(contractId: number, buyerUserId: string) {
  const [contract] = await db
    .select()
    .from(diasporaContracts)
    .where(
      and(
        eq(diasporaContracts.id, contractId),
        eq(diasporaContracts.buyerUserId, buyerUserId),
      )
    )
    .limit(1);
  return contract;
}

// ── GET /api/diaspora-portal/contracts ────────────────────────────────────────
// Returns all contracts where this user is the linked buyer, enriched with
// the property name.
router.get("/contracts", ...auth, async (req: any, res: any) => {
  try {
    const buyerUserId: string = req.user.id;

    const rows = await db
      .select({
        id: diasporaContracts.id,
        propertyId: diasporaContracts.propertyId,
        clientName: diasporaContracts.clientName,
        clientEmail: diasporaContracts.clientEmail,
        clientCountry: diasporaContracts.clientCountry,
        totalPropertyValue: diasporaContracts.totalPropertyValue,
        downPayment: diasporaContracts.downPayment,
        monthlyInstallment: diasporaContracts.monthlyInstallment,
        currency: diasporaContracts.currency,
        paymentFrequency: diasporaContracts.paymentFrequency,
        contractDurationMonths: diasporaContracts.contractDurationMonths,
        interestRate: diasporaContracts.interestRate,
        paymentsMade: diasporaContracts.paymentsMade,
        totalPaid: diasporaContracts.totalPaid,
        remainingBalance: diasporaContracts.remainingBalance,
        completionPercentage: diasporaContracts.completionPercentage,
        nextPaymentDue: diasporaContracts.nextPaymentDue,
        constructionStatus: diasporaContracts.constructionStatus,
        constructionStartDate: diasporaContracts.constructionStartDate,
        expectedCompletionDate: diasporaContracts.expectedCompletionDate,
        actualCompletionDate: diasporaContracts.actualCompletionDate,
        paymentMethod: diasporaContracts.paymentMethod,
        internationalProvider: diasporaContracts.internationalProvider,
        contractSignedAt: diasporaContracts.contractSignedAt,
        digitalCertificateIssued: diasporaContracts.digitalCertificateIssued,
        certificateStatus: diasporaContracts.certificateStatus,
        registryLink: diasporaContracts.registryLink,
        legalDocumentUrl: diasporaContracts.legalDocumentUrl,
        status: diasporaContracts.status,
        createdAt: diasporaContracts.createdAt,
        // Joined
        propertyName: properties.name,
        propertyAddress: properties.address,
        propertyImageUrl: properties.imageUrl,
        propertySiteSettings: properties.siteSettings,
      })
      .from(diasporaContracts)
      .leftJoin(properties, eq(diasporaContracts.propertyId, properties.id))
      .where(eq(diasporaContracts.buyerUserId, buyerUserId))
      .orderBy(desc(diasporaContracts.createdAt));

    res.json(rows.map((r: any) => ({
      ...r,
      titleVerificationStatus: (r.propertySiteSettings as any)?.titleVerification?.status ?? "unverified",
      titleVerificationIsSandbox: (r.propertySiteSettings as any)?.titleVerification?.isSandbox ?? false,
    })));
  } catch (err) {
    logger.error("GET /api/diaspora-portal/contracts error:", err);
    res.status(500).json({ message: "Failed to fetch your contracts" });
  }
});

// ── GET /api/diaspora-portal/contracts/:id ────────────────────────────────────
router.get("/contracts/:id", ...auth, async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid contract id" });

    const contract = await getBuyerContract(id, req.user.id);
    if (!contract) return res.status(404).json({ message: "Contract not found" });

    // Enrich with property data
    const [prop] = await db
      .select({ name: properties.name, address: properties.address, imageUrl: properties.imageUrl })
      .from(properties)
      .where(eq(properties.id, contract.propertyId))
      .limit(1);

    res.json({ ...contract, property: prop ?? null });
  } catch (err) {
    logger.error("GET /api/diaspora-portal/contracts/:id error:", err);
    res.status(500).json({ message: "Failed to fetch contract" });
  }
});

// ── GET /api/diaspora-portal/contracts/:id/payments ───────────────────────────
router.get("/contracts/:id/payments", ...auth, async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid contract id" });

    const contract = await getBuyerContract(id, req.user.id);
    if (!contract) return res.status(404).json({ message: "Contract not found" });

    const payments = await db
      .select()
      .from(diasporaPayments)
      .where(eq(diasporaPayments.diasporaContractId, id))
      .orderBy(desc(diasporaPayments.paymentDate));

    res.json(payments);
  } catch (err) {
    logger.error("GET /api/diaspora-portal/contracts/:id/payments error:", err);
    res.status(500).json({ message: "Failed to fetch payment history" });
  }
});

// ── GET /api/diaspora-portal/contracts/:id/construction ───────────────────────
router.get("/contracts/:id/construction", ...auth, async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid contract id" });

    const contract = await getBuyerContract(id, req.user.id);
    if (!contract) return res.status(404).json({ message: "Contract not found" });

    const updates = await db
      .select()
      .from(constructionUpdates)
      .where(eq(constructionUpdates.diasporaContractId, id))
      .orderBy(desc(constructionUpdates.createdAt));

    res.json(updates);
  } catch (err) {
    logger.error("GET /api/diaspora-portal/contracts/:id/construction error:", err);
    res.status(500).json({ message: "Failed to fetch construction updates" });
  }
});

// ── GET /api/diaspora-portal/contracts/:id/certificates ───────────────────────
router.get("/contracts/:id/certificates", ...auth, async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid contract id" });

    const contract = await getBuyerContract(id, req.user.id);
    if (!contract) return res.status(404).json({ message: "Contract not found" });

    const certs = await db
      .select()
      .from(diasporaCertificates)
      .where(eq(diasporaCertificates.diasporaContractId, id))
      .orderBy(desc(diasporaCertificates.createdAt));

    res.json(certs);
  } catch (err) {
    logger.error("GET /api/diaspora-portal/contracts/:id/certificates error:", err);
    res.status(500).json({ message: "Failed to fetch certificates" });
  }
});

// ── GET /api/diaspora-portal/contracts/:id/schedule ──────────────────────────
router.get("/contracts/:id/schedule", ...auth, async (req: any, res: any) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid contract id" });

    const contract = await getBuyerContract(id, req.user.id);
    if (!contract) return res.status(404).json({ message: "Contract not found" });

    const schedule = await db
      .select()
      .from(diasporaPaymentSchedule)
      .where(eq(diasporaPaymentSchedule.diasporaContractId, id))
      .orderBy(asc(diasporaPaymentSchedule.scheduledDate));

    res.json(schedule);
  } catch (err) {
    logger.error("GET /api/diaspora-portal/contracts/:id/schedule error:", err);
    res.status(500).json({ message: "Failed to fetch payment schedule" });
  }
});

// ── GET /api/diaspora-portal/messages ─────────────────────────────────────────
// Returns messages for this buyer's user account (both inbox and sent)
router.get("/messages", ...auth, async (req: any, res: any) => {
  try {
    const userId: string = String(req.user.userId || req.user.id);
    const orgId: number = req.user.organizationId;

    const { messages, users } = await import("@shared/schema");
    const { or, desc } = await import("drizzle-orm");

    const msgs = await db
      .select()
      .from(messages)
      .where(or(eq(messages.fromUserId, userId), eq(messages.toUserId, userId)))
      .orderBy(desc(messages.createdAt))
      .limit(100);

    if (msgs.length === 0) return res.json({ messages: [] });

    const userRows = await db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email })
      .from(users)
      .where(eq(users.organizationId, orgId));

    const userMap = new Map(userRows.map(u => [u.id, u]));
    const getName = (uid: string) => {
      const u = userMap.get(uid);
      if (!u) return "Unknown";
      return [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || "Unknown";
    };

    res.json({
      messages: msgs.map(m => ({
        ...m,
        fromName: getName(m.fromUserId),
        toName: getName(m.toUserId),
        isOwn: m.fromUserId === userId,
      })),
    });
  } catch (err) {
    logger.error("GET /api/diaspora-portal/messages error:", err);
    res.status(500).json({ message: "Failed to fetch messages" });
  }
});

// ── POST /api/diaspora-portal/messages ────────────────────────────────────────
// Send a message to the property manager
router.post("/messages", ...auth, async (req: any, res: any) => {
  try {
    const userId: string = String(req.user.userId || req.user.id);
    const orgId: number = req.user.organizationId;
    const { subject, content, toUserId } = req.body;

    if (!content?.trim()) return res.status(400).json({ message: "Message content is required" });

    const { messages, users } = await import("@shared/schema");
    const { notifyNewMessage } = await import("../ws");
    const { pushNotification } = await import("./notifications");

    let recipientId = toUserId;
    if (!recipientId) {
      // Find the admin first, fall back to any manager in the org
      const { inArray } = await import("drizzle-orm");
      const [recipient] = await db
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(and(
          eq(users.organizationId, orgId),
          inArray(users.role as any, ["admin", "manager"]),
        ))
        .orderBy(users.role) // admin sorts before manager alphabetically
        .limit(1);
      recipientId = recipient?.id ?? userId;
    }

    // Get buyer's real name for the notification
    const [buyerRow] = await db
      .select({ firstName: users.firstName, lastName: users.lastName, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const buyerName = buyerRow
      ? `${buyerRow.firstName ?? ""} ${buyerRow.lastName ?? ""}`.trim() || buyerRow.email || "Diaspora Buyer"
      : "Diaspora Buyer";

    const [msg] = await db
      .insert(messages)
      .values({
        fromUserId: userId,
        toUserId: recipientId,
        subject: subject?.trim() || `Message from ${buyerName}`,
        content: content.trim(),
        organizationId: orgId,
        isRead: false,
        createdAt: new Date(),
      } as any)
      .returning();

    // WebSocket push — notifies manager in real time if they're online
    notifyNewMessage(recipientId, {
      id: msg.id,
      fromName: buyerName,
      subject: subject?.trim() || "Message from diaspora buyer",
      preview: content.trim().slice(0, 80),
    });

    // Persistent in-process notification — visible when manager opens bell
    pushNotification(recipientId, {
      type: "message",
      title: `New message from ${buyerName}`,
      message: content.trim().slice(0, 80),
      ts: new Date().toISOString(),
      link: "/messages",
    });

    res.status(201).json({ message: "Message sent", data: msg });
  } catch (err) {
    logger.error("POST /api/diaspora-portal/messages error:", err);
    res.status(500).json({ message: "Failed to send message" });
  }
});

// ── GET /api/diaspora-portal/documents ────────────────────────────────────────
// Returns documents tagged to this buyer's user id or their contracts
router.get("/documents", ...auth, async (req: any, res: any) => {
  try {
    const userId: string = String(req.user.userId || req.user.id);
    const orgId: number = req.user.organizationId;

    const { documents, properties } = await import("@shared/schema");
    const { or, desc } = await import("drizzle-orm");

    // Get property IDs from buyer's contracts
    const contracts = await db
      .select({ propertyId: diasporaContracts.propertyId })
      .from(diasporaContracts)
      .where(eq(diasporaContracts.buyerUserId, userId));

    const propertyIds = contracts.map(c => c.propertyId).filter(Boolean) as number[];

    // Fetch documents linked to those properties (shared by PM with this buyer).
    // Previously this returned every document tagged to the property with no
    // further filter — including other tenants' private lease documents, ID
    // copies, and other records (anything with tenantId set), since this
    // buyer has no relationship with those tenants and shouldn't see their
    // paperwork. Restricted to property-level documents (tenantId IS NULL).
    let docs: any[] = [];
    if (propertyIds.length > 0) {
      const { inArray, isNull } = await import("drizzle-orm");
      docs = await db
        .select()
        .from(documents)
        .where(and(inArray(documents.propertyId, propertyIds), isNull(documents.tenantId)))
        .orderBy(desc(documents.createdAt))
        .limit(50);
    }

    res.json({ documents: docs });
  } catch (err) {
    logger.error("GET /api/diaspora-portal/documents error:", err);
    res.status(500).json({ message: "Failed to fetch documents" });
  }
});

export default router;