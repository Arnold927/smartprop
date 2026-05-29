/**
 * server/seeds/backfill-tenant-user-ids.ts
 *
 * One-time script: for every tenant record where userId is NULL or points to
 * the wrong user (a manager), look up the user account by the tenant's email
 * and set the correct userId.
 *
 * Run once:
 *   npx tsx server/seeds/backfill-tenant-user-ids.ts
 */

import { db } from "../db";
import { tenants, users } from "@shared/schema";
import { eq, isNull } from "drizzle-orm";

async function backfill() {
  console.log("🔍  Loading tenants with no userId...");

  // Get all tenants — we'll check both null userId and wrong-role userId
  const allTenants = await db
    .select({ id: tenants.id, email: tenants.email, userId: tenants.userId })
    .from(tenants);

  console.log(`   ${allTenants.length} tenant records found`);

  let updated = 0;
  let notFound = 0;

  for (const t of allTenants) {
    if (!t.email) continue;

    // Find the user account with this email
    const [user] = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.email, t.email.toLowerCase()))
      .limit(1);

    if (!user) {
      notFound++;
      continue;
    }

    // Only update if userId is missing OR currently points to a non-tenant account
    if (t.userId === user.id) continue; // already correct

    await db
      .update(tenants)
      .set({ userId: user.id })
      .where(eq(tenants.id, t.id));

    console.log(`   ✓ tenant #${t.id} (${t.email}) → userId ${user.id} (role: ${user.role})`);
    updated++;
  }

  console.log(`\n✅  Done. ${updated} updated, ${notFound} with no matching user account.`);
  if (notFound > 0) {
    console.log(`   ℹ  Tenants with no user account will still work via email fallback in GET /api/tenants/me`);
    console.log(`      once their user logs in for the first time, userId will be backfilled automatically.`);
  }
  process.exit(0);
}

backfill().catch(e => { console.error(e); process.exit(1); });
