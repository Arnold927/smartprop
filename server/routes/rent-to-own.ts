import { Router } from "express";
import { db } from "../db";
import { rentToOwnAgreements, rentToOwnPayments, properties, tenants } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";
import { storage } from "../storage";

// ─── Rent-to-Own Agreements ────────────────────────────────────────────────
export const rentToOwnAgreementsRouter = Router();
rentToOwnAgreementsRouter.use(authenticateJWT as any, requireOrg as any);

rentToOwnAgreementsRouter.get("/", async (req: any, res) => {
  try {
    const orgId: number = req.user.organizationId;
    // Scope via tenantId → tenants.organizationId
    const orgTenants = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.organizationId, orgId));
    const tenantIds = orgTenants.map(t => t.id);
    const agreements = tenantIds.length > 0
      ? await db.select().from(rentToOwnAgreements).where(inArray(rentToOwnAgreements.tenantId, tenantIds))
      : [];
    res.json(agreements);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

rentToOwnAgreementsRouter.get("/:id", async (req, res) => {
  try {
    const agreement = await storage.getRentToOwnAgreement(Number(req.params.id));
    if (!agreement) return res.status(404).json({ message: "Agreement not found" });
    res.json(agreement);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

rentToOwnAgreementsRouter.post("/", async (req, res) => {
  try {
    const body = { ...req.body };
    // Coerce timestamp strings to Date objects so Drizzle can call .toISOString()
    const dateFields = ["nextPaymentDue", "agreementDate", "completionDate"] as const;
    for (const field of dateFields) {
      if (body[field] && !(body[field] instanceof Date)) {
        body[field] = new Date(body[field]);
      }
    }
    const agreement = await storage.createRentToOwnAgreement(body);
    res.status(201).json(agreement);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

rentToOwnAgreementsRouter.patch("/:id", async (req, res) => {
  try {
    const updated = await storage.updateRentToOwnAgreement(Number(req.params.id), req.body);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Rent-to-Own Payments ─────────────────────────────────────────────────
export const rentToOwnPaymentsRouter = Router();
rentToOwnPaymentsRouter.use(authenticateJWT as any, requireOrg as any);

rentToOwnPaymentsRouter.get("/", async (req, res) => {
  try {
    const agreementId = req.query.agreementId ? Number(req.query.agreementId) : undefined;
    const payments = await storage.getRentToOwnPayments(agreementId);
    res.json(payments);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

rentToOwnPaymentsRouter.post("/", async (req, res) => {
  try {
    const body = { ...req.body };
    const dateFields = ["dueDate", "paidDate"] as const;
    for (const field of dateFields) {
      if (body[field] && !(body[field] instanceof Date)) {
        body[field] = new Date(body[field]);
      }
    }
    const payment = await storage.createRentToOwnPayment(body);
    res.status(201).json(payment);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

rentToOwnPaymentsRouter.post("/:id/process", async (req, res) => {
  try {
    const { paidAmount, paymentMethod, transactionId } = req.body;
    const payment = await storage.processRentToOwnPayment(
      Number(req.params.id),
      paidAmount,
      paymentMethod ?? "bank_transfer",
      transactionId ?? `TXN-${Date.now()}`
    );
    res.json(payment);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Ownership Certificates ───────────────────────────────────────────────
export const ownershipCertificatesRouter = Router();

ownershipCertificatesRouter.get("/", async (req, res) => {
  try {
    const certificates = await storage.getOwnershipCertificates();
    res.json(certificates);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

ownershipCertificatesRouter.get("/:id", async (req, res) => {
  try {
    const cert = await storage.getOwnershipCertificate(Number(req.params.id));
    if (!cert) return res.status(404).json({ message: "Certificate not found" });
    res.json(cert);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

ownershipCertificatesRouter.post("/", async (req, res) => {
  try {
    const cert = await storage.createOwnershipCertificate(req.body);
    res.status(201).json(cert);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// Generate certificate from a completed agreement
ownershipCertificatesRouter.post("/generate/:agreementId", async (req, res) => {
  try {
    const cert = await storage.generateOwnershipCertificate(Number(req.params.agreementId));
    res.status(201).json(cert);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── Property Management Agreements ──────────────────────────────────────
export const propertyManagementAgreementsRouter = Router();

propertyManagementAgreementsRouter.get("/", async (req, res) => {
  try {
    const agreements = await storage.getPropertyManagementAgreements();
    res.json(agreements);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

propertyManagementAgreementsRouter.get("/:id", async (req, res) => {
  try {
    const agreement = await storage.getPropertyManagementAgreement(Number(req.params.id));
    if (!agreement) return res.status(404).json({ message: "Agreement not found" });
    res.json(agreement);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

propertyManagementAgreementsRouter.post("/", async (req, res) => {
  try {
    const agreement = await storage.createPropertyManagementAgreement(req.body);
    res.status(201).json(agreement);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});