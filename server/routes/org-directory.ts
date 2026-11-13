/**
 * server/routes/org-directory.ts
 *
 * GET /api/auth/users — a minimal people directory for the caller's own
 * organisation, used as the recipient list in the Staff Portal messages panel
 * and the Property Manager dashboard. The caller's client already requested
 * this path, but nothing served it, so recipient lists were always empty.
 *
 * Deliberately narrow: no email, phone or any other contact detail, only
 * non-tenant roles, and never anyone outside the caller's organisation.
 * (The full user list stays at /api/users for admin/manager.)
 */

import { Router } from "express";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "../db";
import { users } from "@shared/schema";
import { requireOrg } from "../middleware/requireOrg";
import { logger } from "../lib/logger";

const router = Router();
router.use(requireOrg as any);

router.get("/", async (req: any, res) => {
  try {
    const rows = await db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, role: users.role })
      .from(users)
      .where(and(
        eq(users.organizationId, req.user.organizationId),
        inArray(users.role, ["admin", "manager", "staff", "caretaker", "landlord"] as any),
        ne(users.id, req.user.id),
      ))
      .limit(500);
    res.json(rows);
  } catch (err) {
    logger.error("[org-directory] GET /:", err);
    res.status(500).json({ message: "Failed to load directory" });
  }
});

export default router;
