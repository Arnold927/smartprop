/**
 * server/seeds/backfill-property-owner-ids.ts
 *
 * One-time script: for each property where ownerId IS NULL, if the org has
 * exactly one landlord user, assign that landlord as the owner automatically.
 * If there are multiple landlords, print the list so the admin can decide.
 *
 * Run once:
 *   npx tsx server/seeds/backfill-property-owner-ids.ts
 */

import { db } from "../db";
import { properties, users } from "@shared/schema";
import { eq, isNull, and } from "drizzle-orm";

async function backfill() {
  console.log("🔍  Finding properties with no ownerId...");

  const unowned = await db
    .select({ id: properties.id, name: properties.name, organizationId: properties.organizationId })
    .from(properties)
    .where(isNull(properties.ownerId));

  console.log(`   ${unowned.length} unowned properties found`);
  if (!unowned.length) { console.log("✅  Nothing to do."); process.exit(0); }

  for (const prop of unowned) {
    // Find landlord users in the same org
    const landlords = await db
      .select({ id: users.id, email: users.email, firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(and(
        eq(users.organizationId, prop.organizationId),
        eq(users.role, "landlord"),
      ));

    if (landlords.length === 0) {
      console.log(`   ⚠  Property #${prop.id} "${prop.name}" — no landlord users in org ${prop.organizationId}`);
      continue;
    }

    if (landlords.length === 1) {
      await db
        .update(properties)
        .set({ ownerId: landlords[0].id })
        .where(eq(properties.id, prop.id));
      console.log(`   ✓  Property #${prop.id} "${prop.name}" → ${landlords[0].email}`);
      continue;
    }

    // Multiple landlords — print options for manual assignment
    console.log(`   ⚠  Property #${prop.id} "${prop.name}" — ${landlords.length} landlords in org, assign manually:`);
    landlords.forEach(l => console.log(`      • ${l.id}  ${l.firstName} ${l.lastName} (${l.email})`));
    console.log(`      Run: UPDATE properties SET owner_id = '<uuid>' WHERE id = ${prop.id};`);
  }

  console.log("\n✅  Done.");
  process.exit(0);
}

backfill().catch(e => { console.error(e); process.exit(1); });
