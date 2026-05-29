/**
 * seed-roles.ts
 *
 * Upserts the seven canonical SmartProp roles into the `user_roles` table,
 * setting their default permission sets.
 *
 * Run once (or on every deploy — it's idempotent):
 *   npx tsx server/seeds/seed-roles.ts
 *
 * The seed uses ON CONFLICT (role_name) DO UPDATE so it is safe to re-run:
 * - New roles are inserted.
 * - Existing roles have their description and isActive refreshed, but their
 *   permissions are NOT overwritten (to preserve any admin customisations).
 *   Pass --reset-permissions to force the defaults back.
 */

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "../db.js";
import { userRoles } from "../../shared/schema.js";
import { eq } from "drizzle-orm";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const RESET_PERMISSIONS = process.argv.includes("--reset-permissions");

// ── Default permission sets ───────────────────────────────────────────────────

type Perms = Record<string, boolean>;

const ALL_OFF: Perms = {
  full_access: false,
  can_manage_users: false,
  can_view_users: false,
  can_manage_properties: false,
  can_manage_tenants: false,
  can_manage_leases: false,
  can_view_documents: false,
  can_upload_documents: false,
  can_view_financials: false,
  can_collect_rent: false,
  can_make_payments: false,
  can_view_payment_history: false,
  can_submit_invoices: false,
  can_generate_reports: false,
  can_manage_maintenance: false,
  can_submit_maintenance: false,
  can_view_maintenance: false,
  can_manage_construction: false,
  can_assign_tasks: false,
  can_view_assigned_jobs: false,
  can_view_project_progress: false,
  can_message: false,
  can_view_announcements: false,
  can_clock_in_out: false,
  can_submit_timesheets: false,
};

function perms(grants: (keyof typeof ALL_OFF)[]): Perms {
  const p = { ...ALL_OFF };
  for (const k of grants) p[k] = true;
  return p;
}

interface RoleSeed {
  roleName: string;
  roleDescription: string;
  permissions: Perms;
}

// Roles mirror the values in users.role (varchar) and each portal in the app.
const ROLE_SEEDS: RoleSeed[] = [
  {
    roleName: "admin",
    roleDescription: "Full system access. Can manage all users, settings, and data across every portal.",
    permissions: perms(Object.keys(ALL_OFF) as (keyof typeof ALL_OFF)[]),
  },
  {
    roleName: "manager",
    roleDescription: "Property manager — full operational suite: tenants, leases, finance, maintenance, reports.",
    permissions: perms([
      "can_manage_users","can_view_users","can_manage_properties","can_manage_tenants",
      "can_manage_leases","can_view_documents","can_upload_documents","can_view_financials",
      "can_collect_rent","can_generate_reports","can_manage_maintenance","can_view_maintenance",
      "can_assign_tasks","can_view_assigned_jobs","can_submit_invoices",
      "can_message","can_view_announcements",
    ]),
  },
  {
    roleName: "landlord",
    roleDescription: "Property owner — landlord portal: own portfolio, financials, maintenance visibility, documents.",
    permissions: perms([
      "can_view_users","can_manage_properties","can_manage_tenants",
      "can_manage_leases","can_view_documents","can_upload_documents",
      "can_view_financials","can_collect_rent","can_generate_reports",
      "can_view_maintenance","can_message","can_view_announcements",
    ]),
  },
  {
    roleName: "staff",
    roleDescription: "Operations staff — staff portal: maintenance, security, utilities, inspections, time tracking.",
    permissions: perms([
      "can_view_users","can_view_documents","can_upload_documents",
      "can_manage_maintenance","can_view_maintenance","can_assign_tasks",
      "can_view_assigned_jobs","can_submit_invoices",
      "can_message","can_view_announcements",
      "can_clock_in_out","can_submit_timesheets",
    ]),
  },
  {
    roleName: "caretaker",
    roleDescription: "On-site caretaker — property-scoped: maintenance requests, visitor log, clock in/out.",
    permissions: perms([
      "can_submit_maintenance","can_view_maintenance","can_manage_maintenance",
      "can_message","can_view_announcements","can_clock_in_out",
    ]),
  },
  {
    roleName: "tenant",
    roleDescription: "Occupant — tenant portal: pay rent, raise maintenance requests, view documents.",
    permissions: perms([
      "can_submit_maintenance","can_make_payments","can_view_payment_history",
      "can_view_documents","can_view_maintenance","can_message","can_view_announcements",
    ]),
  },
  {
    roleName: "guard",
    roleDescription: "Security guard — gate portal: visitor check-in and log only.",
    permissions: perms([
      "can_view_announcements","can_message",
    ]),
  },
  {
    roleName: "contractor",
    roleDescription: "External contractor — contractor portal: view assigned jobs, submit invoices, upload docs.",
    permissions: perms([
      "can_view_documents","can_upload_documents","can_submit_invoices",
      "can_view_assigned_jobs","can_view_maintenance","can_message","can_view_announcements",
    ]),
  },
];

// ── Seed logic ────────────────────────────────────────────────────────────────

async function seed() {
  console.log("🌱  Seeding user_roles table…");
  console.log(
    RESET_PERMISSIONS
      ? "⚠️   --reset-permissions flag set: default permissions will be restored."
      : "ℹ️   Permissions will NOT be overwritten for existing roles (safe re-run)."
  );

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const role of ROLE_SEEDS) {
    // Check if the role already exists
    const [existing] = await db
      .select({ id: userRoles.id, roleName: userRoles.roleName })
      .from(userRoles)
      .where(eq(userRoles.roleName, role.roleName))
      .limit(1);

    if (!existing) {
      // Insert fresh
      await db.insert(userRoles).values({
        roleName: role.roleName,
        roleDescription: role.roleDescription,
        permissions: role.permissions,
        isActive: true,
      });
      console.log(`  ✅  Inserted: ${role.roleName}`);
      inserted++;
    } else if (RESET_PERMISSIONS) {
      // Update description + permissions (only when flag is passed)
      await db
        .update(userRoles)
        .set({
          roleDescription: role.roleDescription,
          permissions: role.permissions,
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(userRoles.roleName, role.roleName));
      console.log(`  🔄  Reset:    ${role.roleName}`);
      updated++;
    } else {
      // Exists, no reset — just refresh description & isActive, leave permissions alone
      await db
        .update(userRoles)
        .set({
          roleDescription: role.roleDescription,
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(userRoles.roleName, role.roleName));
      console.log(`  ⏭️   Skipped permissions for: ${role.roleName} (already exists)`);
      skipped++;
    }
  }

  console.log(
    `\n✔  Done. ${inserted} inserted · ${updated} reset · ${skipped} skipped (permissions preserved).`
  );
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});