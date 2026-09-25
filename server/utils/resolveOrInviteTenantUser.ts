/**
 * server/utils/resolveOrInviteTenantUser.ts
 *
 * Resolves (or creates) a login-capable user account for a tenant, and
 * returns its id.
 *
 * tenants.userId is NOT NULL (same constraint as caretakers.userId — see
 * resolveOrInviteCaretakerUser.ts, which this mirrors), so the tenant
 * record literally cannot be created without a resolved user id first.
 * This function must be awaited, and its result used to create the tenant
 * record — it is NOT fire-and-forget, unlike the older inviteTenantUser.ts,
 * which fired after the tenant row was already inserted and could never
 * actually satisfy this constraint for a brand-new tenant (no pre-existing
 * account = nothing to put in a NOT NULL column). That was a real bug:
 * adding any tenant with no pre-existing login would fail the database's
 * NOT NULL constraint on insert. This replaces it in both callers
 * (server/routes/tenants.ts and server/routes/tenant-onboarding.ts).
 *
 * The invite EMAIL itself is still fire-and-forget within this function —
 * only the user row (and its id) needs to be awaited; if Resend fails, the
 * tenant record still gets created correctly, just with the email silently
 * unsent (logged either way).
 */

import { randomUUID } from "crypto";
import { db } from "../db";
import { users, organizations } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { sendInviteEmail } from "../lib/email";

export async function resolveOrInviteTenantUser(opts: {
  organizationId: number;
  invitedByUserId: string;
  email: string;
  firstName: string;
  lastName: string;
}): Promise<string> {
  const { organizationId, invitedByUserId, email, firstName, lastName } = opts;
  const normalizedEmail = email.toLowerCase();

  // Already exists in this org? Reuse it (and make sure their role is
  // correctly "tenant" — matches the onConflictDoUpdate behavior of the
  // sibling invite helpers).
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.organizationId, organizationId), eq(users.email, normalizedEmail)))
    .limit(1);

  if (existing) {
    await db.update(users).set({ role: "tenant" }).where(eq(users.id, existing.id));
    return existing.id;
  }

  const newUserId = randomUUID();
  const inviteToken = randomUUID();
  const inviteExpiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 7 days

  await db.insert(users).values({
    id: newUserId,
    email: normalizedEmail,
    role: "tenant",
    organizationId,
    firstName,
    lastName,
    passwordHash: "",
    emailVerified: false,
    invitedAt: new Date(),
    invitedBy: invitedByUserId,
    emailVerificationToken: inviteToken,
    emailVerificationExpiresAt: inviteExpiresAt,
  } as any);

  // Fire-and-forget from here — the user row (and its id, already returned
  // to the caller below) is what matters for creating the tenant record.
  (async () => {
    try {
      const [org] = await db
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);

      const inviteLink = `${process.env.APP_URL || "http://localhost:5173"}/accept-invite/${inviteToken}`;

      await sendInviteEmail({
        to: normalizedEmail,
        inviteLink,
        subject: org?.name ? `You've been added as a tenant with ${org.name}` : undefined,
        intro: org?.name
          ? `${org.name} has added you as a tenant on SmartProp. Set up your account to view your lease, pay rent, and submit maintenance requests.`
          : undefined,
      });
      console.log(`[resolveOrInviteTenantUser] Portal invite sent to ${normalizedEmail}`);
    } catch (err) {
      console.warn(`[resolveOrInviteTenantUser] Failed to send portal invite to ${normalizedEmail}:`, err);
    }
  })();

  return newUserId;
}