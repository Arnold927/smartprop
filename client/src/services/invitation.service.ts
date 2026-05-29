import { createUserWithRole } from "./user.service";
import { SYSTEM_ROLES } from "@/constants/roles";
import { generateToken, tokenExpiry } from "@/utils/token";
import { eq } from "drizzle-orm";
import { db } from "server/db";
import { users } from "@shared/schema";

export async function invitePropertyManager({
  email,
  organizationId,
  invitedBy,
}: {
  email: string;
  organizationId: number;
  invitedBy: string;
}) {
  const user = await createUserWithRole({
    email,
    organizationId,
    systemRoleId: SYSTEM_ROLES.PROPERTY_MANAGER,
    baseRole: "manager",
    createdBy: invitedBy,
  });

  const token = generateToken();

  await db
    .update(users)
    .set({
      emailVerificationToken: token,
      emailVerificationExpiresAt: tokenExpiry(48),
    })
    .where(eq(users.id, user.id));

  // 🔔 Send email with invite link
  // /accept-invite?token=xxx

  return user;
}
