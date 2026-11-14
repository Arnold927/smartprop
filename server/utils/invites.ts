/**
 * server/utils/invites.ts
 *
 * One place for everything that creates, re-issues or delivers a portal invite.
 * Before this, six different code paths (users, staff, tenants, caretakers,
 * contractors, diaspora buyers) each hand-rolled their own insert + token +
 * email, and most of them shared two serious defects:
 *
 *   1. They upserted on (organization, email) WITHOUT checking whether that
 *      account was already active, so adding e.g. a contractor, caretaker or
 *      buyer with an existing admin's / staff member's email silently changed
 *      that account's role (locking the admin out of the admin screens) and,
 *      in the upsert variants, issued a fresh set-password token for it.
 *   2. The invite link only ever existed inside the email. If the email could
 *      not be sent there was no way for the manager to get the link.
 *
 * issueInvite() only ever creates a new pending account or re-issues a still-
 * pending one. An active account is left exactly as it is; asking to give it a
 * different role throws InviteConflictError (HTTP 409 for the caller).
 */

import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { users } from "@shared/schema";
import { sendInviteEmail } from "../lib/email";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — what the email promises

export class InviteConflictError extends Error {
  status = 409;
  constructor(message: string) {
    super(message);
    this.name = "InviteConflictError";
  }
}

/** Shared wording for "this email already lives in another organisation". */
export function organisationConflictMessage(email: string): string {
  return `${email} already has a SmartProp account in another organisation, and an email can only belong to one. Use a different email, or ask the SmartProp platform admin to link the account.`;
}

export function buildInviteLink(token: string): string {
  const base = (process.env.APP_URL || "http://localhost:5173").replace(/\/+$/, "");
  return `${base}/accept-invite/${token}`;
}

/** A login that was invited but whose owner has not set a password yet. */
export function isPendingInvite(u: { passwordHash: string | null; emailVerified: boolean | null }): boolean {
  return (u.passwordHash ?? "") === "" && !u.emailVerified;
}

type Executor = Pick<typeof db, "select" | "insert" | "update">;

export type IssuedInvite = {
  userId: string;
  /** "created" = new pending login, "reissued" = pending login got a fresh link, "active" = already has a working account. */
  status: "created" | "reissued" | "active";
  /** null when status is "active" — there is nothing to accept. */
  token: string | null;
  link: string | null;
};

export async function issueInvite(opts: {
  organizationId: number;
  invitedByUserId: string;
  email: string;
  role: string;
  firstName?: string | null;
  lastName?: string | null;
  executor?: Executor;
}): Promise<IssuedInvite> {
  const ex = opts.executor ?? db;
  const email = opts.email.trim().toLowerCase();

  const [existing] = await ex
    .select({
      id: users.id,
      role: users.role,
      passwordHash: users.passwordHash,
      emailVerified: users.emailVerified,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(users)
    .where(and(eq(users.organizationId, opts.organizationId), eq(users.email, email)))
    .limit(1);

  const token = randomUUID();
  const expires = new Date(Date.now() + INVITE_TTL_MS);

  if (!existing) {
    // Sign-in finds an account by email alone, so one email can only belong to ONE organisation.
    // Without this check a second (pending) account with the same email was created in this
    // organisation and sign-in could not tell the two apart.
    const [elsewhere] = await ex
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (elsewhere) {
      throw new InviteConflictError(organisationConflictMessage(email));
    }
    const id = randomUUID();
    await ex.insert(users).values({
      id,
      email,
      role: opts.role,
      organizationId: opts.organizationId,
      firstName: opts.firstName ?? null,
      lastName: opts.lastName ?? null,
      passwordHash: "",
      emailVerified: false,
      invitedAt: new Date(),
      invitedBy: opts.invitedByUserId,
      emailVerificationToken: token,
      emailVerificationExpiresAt: expires,
    } as any);
    return { userId: id, status: "created", token, link: buildInviteLink(token) };
  }

  if (isPendingInvite(existing)) {
    await ex
      .update(users)
      .set({
        role: opts.role,
        invitedAt: new Date(),
        invitedBy: opts.invitedByUserId,
        emailVerificationToken: token,
        emailVerificationExpiresAt: expires,
        ...(opts.firstName && !existing.firstName ? { firstName: opts.firstName } : {}),
        ...(opts.lastName && !existing.lastName ? { lastName: opts.lastName } : {}),
        updatedAt: new Date(),
      } as any)
      .where(eq(users.id, existing.id));
    return { userId: existing.id, status: "reissued", token, link: buildInviteLink(token) };
  }

  // Active account. Fine to reuse if it already has the role this flow needs;
  // never change an active account's role from here.
  const currentRole = existing.role ?? "";
  if (currentRole === opts.role || currentRole === "" || currentRole === "user") {
    return { userId: existing.id, status: "active", token: null, link: null };
  }
  throw new InviteConflictError(
    `${email} already has an active ${currentRole} account in your organisation, so it can't also be added as a ${opts.role}. Use a different email address.`,
  );
}

/** Sends the invite email. Never throws — returns whether it was actually sent. */
export async function deliverInvite(opts: {
  to: string;
  link: string;
  subject?: string;
  intro?: string;
  expiryNote?: string;
}): Promise<boolean> {
  try {
    await sendInviteEmail({
      to: opts.to.trim().toLowerCase(),
      inviteLink: opts.link,
      subject: opts.subject,
      intro: opts.intro,
      expiryNote: opts.expiryNote,
    });
    return true;
  } catch (err) {
    console.warn(`[invites] Invite email to ${opts.to} could not be sent:`, (err as any)?.message ?? err);
    return false;
  }
}

/** What flows hand back to the browser so the manager can always see/copy the link. */
export type InviteResult = {
  status: IssuedInvite["status"];
  /** The set-password link, or null when the person already had an account. */
  link: string | null;
  emailSent: boolean;
};
