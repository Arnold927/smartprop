/**
 * server/utils/resolveOrInviteTenantUser.ts
 *
 * Resolves (or creates) the login-capable user account for a tenant and
 * returns its id plus what happened to the invite.
 *
 * tenants.userId is NOT NULL, so the record cannot be created without a
 * resolved user id first — this must be awaited and its userId used for the
 * insert.
 *
 * Built on issueInvite() (server/utils/invites.ts): a new email gets a pending
 * login, a still-pending one gets a fresh link, and an account that is already
 * active is reused untouched. If that active account belongs to someone with a
 * different role (an admin, a landlord...) InviteConflictError is thrown and
 * callers answer 409 — previously this silently rewrote that person's role.
 *
 * The invite EMAIL is attempted but never fails the request; the result says
 * whether it went out and carries the link so the manager can share it by hand.
 */

import { db } from "../db";
import { organizations } from "@shared/schema";
import { eq } from "drizzle-orm";
import { issueInvite, deliverInvite, type InviteResult } from "./invites";

export async function resolveOrInviteTenantUser(opts: {
  organizationId: number;
  invitedByUserId: string;
  email: string;
  firstName: string;
  lastName: string;
}): Promise<{ userId: string; invite: InviteResult }> {
  const { organizationId, invitedByUserId, email, firstName, lastName } = opts;

  const issued = await issueInvite({
    organizationId,
    invitedByUserId,
    email,
    role: "tenant",
    firstName,
    lastName,
  });

  let emailSent = false;
  if (issued.link) {
    const [org] = await db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    emailSent = await deliverInvite({
      to: email,
      link: issued.link,
      subject: org?.name ? `You've been added as a tenant with ${org.name}` : undefined,
      intro: org?.name
        ? `${org.name} has added you as a tenant on SmartProp. Set up your account to view your lease, pay rent, and submit maintenance requests.`
        : undefined,
    });
  }

  return { userId: issued.userId, invite: { status: issued.status, link: issued.link, emailSent } };
}
