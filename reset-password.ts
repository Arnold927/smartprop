import bcrypt from "bcrypt";
import { db } from "./server/db";
import { users } from "./shared/schema";
import { sql } from "drizzle-orm";

const EMAIL        = "otieno.arnold.jkuat.ac.ke@gmail.com";
const NEW_PASSWORD = "Arnoldomondi_09";

const hash = await bcrypt.hash(NEW_PASSWORD, 12);

const result = await db
  .update(users)
  .set({
    passwordHash:               hash,
    emailVerified:              true,
    emailVerificationToken:     null,
    emailVerificationExpiresAt: null,
    updatedAt:                  new Date(),
  } as any)
  .where(sql`lower(${users.email}) = lower(${EMAIL})`)
  .returning({ id: users.id, email: users.email });

if (result.length === 0) {
  console.error("❌  No user found with that email.");
} else {
  console.log(`✓  Password updated for ${result[0].email}. You can now log in.`);
}

process.exit(0);