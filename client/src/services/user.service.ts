import { db } from "server/db";
import { users } from "@shared/schema";
import { storage } from "server/storage";
import { hashPassword } from "@/utils/password";
import { SYSTEM_ROLES } from "@/constants/roles";

interface CreateUserInput {
  email: string;
  password?: string; // optional for invited users
  firstName?: string;
  lastName?: string;
  organizationId?: number;
  createdBy?: string;
  systemRoleId: number;
  baseRole: "admin" | "manager" | "tenant";
}

export async function createUserWithRole(input: CreateUserInput) {
  return await db.transaction(async (tx:any) => {
    const passwordHash = input.password
      ? await hashPassword(input.password)
      : await hashPassword(Math.random().toString(36));

    // 1️⃣ Create base user
    const [user] = await tx
      .insert(users)
      .values({
        email: input.email,
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        role: input.baseRole,
        organizationId: input.organizationId,
        invitedBy: input.createdBy,
        invitedAt: input.password ? null : new Date(),
      })
      .returning();

    // 2️⃣ Assign RBAC role
    await storage.assignUserRole({
      userId: user.id,
      roleId: input.systemRoleId,
      assignedBy: input.createdBy!,
      assignedAt: new Date(),
      isActive: true,
    });

    return user;
  });
}
