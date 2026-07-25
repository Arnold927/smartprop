/**
 * server/utils/inviteTenantUser.ts
 *
 * Creates (or refreshes) a login-capable user account for a newly created
 * tenant and emails them an invite link to set their password.
 *
 * Extracted from tenant-onboarding.ts, which used to be the ONLY tenant-
 * creation path that did this — POST /api/tenants (used by
 * property-details.tsx's own "Add Tenant" dialog) created the tenant
 * business record only, with no way for that tenant to ever log in. Both
 * paths now call this same function, so which "Add Tenant" button someone
 * happens to click no longer determines whether the tenant gets portal
 * access.
 *
 * Fire-and-forget by design, matching the original behavior — the tenant
 * record itself is already created and committed by the time this runs, so
 * a failure here (e.g. Resend not configured) shouldn't fail the "add
 * tenant" request the caller is already responding to. It's logged either
 * way so it's discoverable, not silently lost.
 */

import { randomUUID } from "crypto";
import { db } from "../db";
import { users, organizations } from "@shared/schema";
import { eq } from "drizzle-orm";
import { sendInviteEmail } from "../lib/email";

export function inviteTenantUser(opts: {
  organizationId: number;
  invitedByUserId: string;
  email: string | null | undefined;
  firstName: string;
  lastName: string;
}): void {
  const { organizationId, invitedByUserId, email, firstName, lastName } = opts;
  if (!email) return;

  (async () => {
    try {
      const [org] = await db
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);

      const inviteToken     = randomUUID();
      const inviteExpiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 7 days

      await db
        .insert(users)
        .values({
          id:                         randomUUID(),
          email:                      email.toLowerCase(),
          role:                       "tenant",
          organizationId,
          firstName,
          lastName,
          passwordHash:               "",
          emailVerified:              false,
          invitedAt:                  new Date(),
          invitedBy:                  invitedByUserId,
          emailVerificationToken:     inviteToken,
          emailVerificationExpiresAt: inviteExpiresAt,
        } as any)
        .onConflictDoUpdate({
          target: [users.organizationId, users.email],
          set: {
            role:                       "tenant",
            invitedAt:                  new Date(),
            emailVerificationToken:     inviteToken,
            emailVerificationExpiresAt: inviteExpiresAt,
          },
        });

      const inviteLink = `${process.env.APP_URL || "http://localhost:5173"}/accept-invite/${inviteToken}`;

      // org.name was previously fetched and never actually used in the
      // email — now it names the org in the invite so the tenant knows who
      // added them, instead of a generic "you've been invited" message.
      await sendInviteEmail({
        to: email.toLowerCase(),
        inviteLink,
        subject: org?.name ? `You've been added as a tenant with ${org.name}` : undefined,
        intro: org?.name
          ? `${org.name} has added you as a tenant on SmartProp. Set up your account to view your lease, pay rent, and submit maintenance requests.`
          : undefined,
      });

      console.log(`[inviteTenantUser] Portal invite sent to ${email}`);
    } catch (err) {
      console.warn(`[inviteTenantUser] Failed to send portal invite to ${email}:`, err);
    }
  })();
}