/**
 * server/utils/resolveOrInviteCaretakerUser.ts
 *
 * Resolves (or creates) a login-capable user account for a caretaker, and
 * returns its id.
 *
 * Different from inviteTenantUser.ts / inviteStaffUser.ts in one important
 * way: those are fire-and-forget, because the tenant/staff business record
 * is already created and committed by the time the invite fires — a
 * failure there doesn't leave anything broken. Caretakers are the opposite:
 * caretakers.userId is NOT NULL, so the caretaker record literally cannot
 * be created without a resolved user id first. This function must be
 * awaited, and its result used to create the caretaker record.
 *
 * The invite EMAIL itself is still fire-and-forget within this function —
 * only the user row (and its id) needs to be awaited; if Resend fails, the
 * caretaker record still gets created correctly, just with the email
 * silently unsent (logged either way).
 */

import { randomUUID } from "crypto";
import { db } from "../db";
import { users, organizations } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { sendInviteEmail } from "../lib/email";

export async function resolveOrInviteCaretakerUser(opts: {
  organizationId: number;
  invitedByUserId: string;
  email: string;
  firstName: string;
  lastName: string;
}): Promise<string> {
  const { organizationId, invitedByUserId, email, firstName, lastName } = opts;
  const normalizedEmail = email.toLowerCase();

  // Already exists in this org? Reuse it (and make sure their role is
  // correctly "caretaker" — matches the onConflictDoUpdate behavior of the
  // sibling invite helpers).
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.organizationId, organizationId), eq(users.email, normalizedEmail)))
    .limit(1);

  if (existing) {
    await db.update(users).set({ role: "caretaker" }).where(eq(users.id, existing.id));
    return existing.id;
  }

  const newUserId = randomUUID();
  const inviteToken = randomUUID();
  const inviteExpiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 7 days

  await db.insert(users).values({
    id: newUserId,
    email: normalizedEmail,
    role: "caretaker",
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
  // to the caller below) is what matters for creating the caretaker record.
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
        subject: org?.name ? `You've been added as a caretaker with ${org.name}` : undefined,
        intro: org?.name
          ? `${org.name} has added you as a caretaker on SmartProp. Set up your account to get started.`
          : undefined,
      });
      console.log(`[resolveOrInviteCaretakerUser] Portal invite sent to ${normalizedEmail}`);
    } catch (err) {
      console.warn(`[resolveOrInviteCaretakerUser] Failed to send portal invite to ${normalizedEmail}:`, err);
    }
  })();

  return newUserId;
}