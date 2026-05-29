/**
 * server/__tests__/helpers.ts
 *
 * Shared test helpers for integration tests.
 * Each test suite gets a fresh test user + org, cleans up after itself.
 */

import supertest from "supertest";
import { db } from "../db";
import {
  users, organizations, properties, units, tenants,
  refreshTokens,
} from "@shared/schema";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcrypt";
import { randomUUID } from "crypto";

// ─── App singleton ────────────────────────────────────────────────────────────
// Import the Express app without starting the server

let _app: any = null;
export async function getApp() {
  if (_app) return _app;
  const { createApp } = await import("../app");
  _app = await createApp();
  return _app;
}

// ─── Test credentials ─────────────────────────────────────────────────────────

export const TEST_ADMIN_EMAIL    = `test-admin-${Date.now()}@smartprop-test.local`;
export const TEST_TENANT_EMAIL   = `test-tenant-${Date.now()}@smartprop-test.local`;
export const TEST_PASSWORD       = "TestPass1!";  // meets complexity policy

// ─── Setup / teardown helpers ─────────────────────────────────────────────────

export interface TestContext {
  orgId:         number;
  adminUserId:   string;
  tenantUserId:  string;
  tenantId:      number;
  propertyId:    number;
  unitId:        number;
  adminToken:    string;
  tenantToken:   string;
}

/**
 * Creates a minimal org, admin user, property, unit, tenant, and returns tokens.
 * Call in beforeAll(); call cleanupTestData(ctx) in afterAll().
 */
export async function setupTestData(): Promise<TestContext> {
  // 1. Organisation
  const slug = `test-org-${randomUUID().slice(0, 8)}`;
  const [org] = await db.insert(organizations).values({
    name: `Test Org ${slug}`,
    slug,
    isActive: true,
  } as any).returning({ id: organizations.id });
  const orgId = org.id;

  // 2. Admin user
  const adminHash = await bcrypt.hash(TEST_PASSWORD, 10);
  const [adminUser] = await db.insert(users).values({
    id:             randomUUID(),
    email:          TEST_ADMIN_EMAIL,
    passwordHash:   adminHash,
    firstName:      "Test",
    lastName:       "Admin",
    role:           "admin",
    organizationId: orgId,
    emailVerified:  true,
  } as any).returning({ id: users.id });

  // 3. Property
  const [prop] = await db.insert(properties).values({
    organizationId: orgId,
    name:           "Test Property",
    address:        "Test Road, Nairobi",
    totalUnits:     1,
  } as any).returning({ id: properties.id });

  // 4. Unit
  const [unit] = await db.insert(units).values({
    organizationId: orgId,
    propertyId:     prop.id,
    unitNumber:     "T01",
    monthlyRent:    "50000",
    currency:       "KES",
    isOccupied:     false,
  } as any).returning({ id: units.id });

  // 5. Tenant user
  const tenantHash = await bcrypt.hash(TEST_PASSWORD, 10);
  const [tenantUser] = await db.insert(users).values({
    id:             randomUUID(),
    email:          TEST_TENANT_EMAIL,
    passwordHash:   tenantHash,
    firstName:      "Test",
    lastName:       "Tenant",
    role:           "tenant",
    organizationId: orgId,
    emailVerified:  true,
  } as any).returning({ id: users.id });

  // 6. Tenant record
  const [tenant] = await db.insert(tenants).values({
    organizationId: orgId,
    userId:         tenantUser.id,
    firstName:      "Test",
    lastName:       "Tenant",
    email:          TEST_TENANT_EMAIL,
    unitId:         unit.id,
    monthlyRent:    "50000",
    currency:       "KES",
    status:         "active",
  } as any).returning({ id: tenants.id });

  // 7. Get tokens via login endpoint
  const app = await getApp();
  const adminLogin  = await supertest(app).post("/api/auth/login").send({ email: TEST_ADMIN_EMAIL,  password: TEST_PASSWORD });
  const tenantLogin = await supertest(app).post("/api/auth/login").send({ email: TEST_TENANT_EMAIL, password: TEST_PASSWORD });

  return {
    orgId,
    adminUserId:  adminUser.id,
    tenantUserId: tenantUser.id,
    tenantId:     tenant.id,
    propertyId:   prop.id,
    unitId:       unit.id,
    adminToken:   adminLogin.body.accessToken,
    tenantToken:  tenantLogin.body.accessToken,
  };
}

/** Delete everything created by setupTestData(). */
export async function cleanupTestData(ctx: TestContext) {
  await db.delete(tenants).where(eq(tenants.organizationId, ctx.orgId)).catch(() => {});
  await db.delete(units).where(eq(units.organizationId,    ctx.orgId)).catch(() => {});
  await db.delete(properties).where(eq(properties.organizationId, ctx.orgId)).catch(() => {});
  await db.delete(refreshTokens).where(eq(refreshTokens.userId, ctx.adminUserId)).catch(() => {});
  await db.delete(refreshTokens).where(eq(refreshTokens.userId, ctx.tenantUserId)).catch(() => {});
  await db.delete(users).where(eq(users.organizationId, ctx.orgId)).catch(() => {});
  await db.delete(organizations).where(eq(organizations.id, ctx.orgId)).catch(() => {});
}

/** Shorthand: authenticated GET */
export function authedGet(app: any, path: string, token: string) {
  return supertest(app).get(path).set("Authorization", `Bearer ${token}`);
}

/** Shorthand: authenticated POST */
export function authedPost(app: any, path: string, token: string, body: object = {}) {
  return supertest(app).post(path).set("Authorization", `Bearer ${token}`).send(body);
}

/** Shorthand: authenticated PATCH */
export function authedPatch(app: any, path: string, token: string, body: object = {}) {
  return supertest(app).patch(path).set("Authorization", `Bearer ${token}`).send(body);
}

/** Shorthand: authenticated PUT */
export function authedPut(app: any, path: string, token: string, body: object = {}) {
  return supertest(app).put(path).set("Authorization", `Bearer ${token}`).send(body);
}
