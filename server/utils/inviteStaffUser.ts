/**
 * server/utils/inviteStaffUser.ts
 *
 * Creates (or refreshes) a login-capable user account for a newly created
 * staff member and emails them an invite link to set their password.
 *
 * Role is always "staff" regardless of position (property_manager,
 * technician, groundskeeper, ...) — position is an HR job title on
 * staffMembers, not a login permission level. An admin can promote someone
 * afterwards from the Users page.
 *
 * Built on issueInvite(): an email that already belongs to an active account
 * with another role is NOT touched (it used to be silently re-roled to staff).
 * The HR record is already saved by the time this runs, so the result is
 * returned for the caller to report rather than thrown.
 */

import { db } from "../db";
import { organizations } from "@shared/schema";
import { eq } from "drizzle-orm";
import { issueInvite, deliverInvite, InviteConflictError, type InviteResult } from "./invites";

export async function inviteStaffUser(opts: {
  organizationId: number;
  invitedByUserId: string;
  email: string | null | undefined;
  firstName: string;
  lastName: string;
  position?: string;
}): Promise<(InviteResult & { warning?: string }) | null> {
  const { organizationId, invitedByUserId, email, firstName, lastName, position } = opts;
  if (!email) return null;

  try {
    const issued = await issueInvite({ organizationId, invitedByUserId, email, role: "staff", firstName, lastName });
    let emailSent = false;
    if (issued.link) {
      const [org] = await db
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);
      const positionLabel = position ? position.replace(/_/g, " ") : "team member";
      emailSent = await deliverInvite({
        to: email,
        link: issued.link,
        subject: org?.name ? `You've been added to ${org.name} on SmartProp` : undefined,
        intro: org?.name
          ? `${org.name} has added you as a ${positionLabel} on SmartProp. Set up your account to get started.`
          : undefined,
      });
    }
    return { status: issued.status, link: issued.link, emailSent };
  } catch (err) {
    if (err instanceof InviteConflictError) {
      return { status: "active", link: null, emailSent: false, warning: err.message };
    }
    console.warn(`[inviteStaffUser] Could not create portal login for ${email}:`, err);
    return null;
  }
}
