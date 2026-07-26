/**
 * server/utils/inviteStaffUser.ts
 *
 * Creates (or refreshes) a login-capable user account for a newly created
 * staff member and emails them an invite link to set their password.
 *
 * Mirrors inviteTenantUser.ts's pattern. Before this, POST /api/staff-members
 * created only the staffMembers HR record (name, position, department,
 * salary, hire date) — no users row, no invite, no way for that person to
 * ever log in. The only other way to get a login account was the separate
 * admin "invite a user" flow (POST /api/users), matched up afterward purely
 * by email with no foreign key connecting the two records at all.
 *
 * Role is always "staff" regardless of position (property_manager,
 * technician, groundskeeper, etc.) — position is an HR job title on
 * staffMembers, not a login permission level, and there is no dedicated
 * AppRole for most positions. An admin can manually promote someone to
 * "manager" afterward via the Users page if their role warrants it.
 *
 * Fire-and-forget by design, matching inviteTenantUser.ts — the staff
 * record itself is already created and committed by the time this runs, so
 * a failure here (e.g. Resend not configured) shouldn't fail the "add
 * staff member" request. Logged either way so it's discoverable.
 */

import { randomUUID } from "crypto";
import { db } from "../db";
import { users, organizations } from "@shared/schema";
import { eq } from "drizzle-orm";
import { sendInviteEmail } from "../lib/email";

export function inviteStaffUser(opts: {
  organizationId: number;
  invitedByUserId: string;
  email: string | null | undefined;
  firstName: string;
  lastName: string;
  position?: string;
}): void {
  const { organizationId, invitedByUserId, email, firstName, lastName, position } = opts;
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
          role:                       "staff",
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
            role:                       "staff",
            invitedAt:                  new Date(),
            emailVerificationToken:     inviteToken,
            emailVerificationExpiresAt: inviteExpiresAt,
          },
        });

      const inviteLink = `${process.env.APP_URL || "http://localhost:5173"}/accept-invite/${inviteToken}`;
      const positionLabel = position ? position.replace(/_/g, " ") : "team member";

      await sendInviteEmail({
        to: email.toLowerCase(),
        inviteLink,
        subject: org?.name ? `You've been added to ${org.name} on SmartProp` : undefined,
        intro: org?.name
          ? `${org.name} has added you as a ${positionLabel} on SmartProp. Set up your account to get started.`
          : undefined,
      });

      console.log(`[inviteStaffUser] Portal invite sent to ${email}`);
    } catch (err) {
      console.warn(`[inviteStaffUser] Failed to send portal invite to ${email}:`, err);
    }
  })();
}