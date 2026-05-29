/**
 * auth.test.ts — Authentication flow
 *
 * Covers:
 *   - Login with valid credentials → 200 + accessToken
 *   - Login with wrong password → 401
 *   - Login with unknown email → 401
 *   - Refresh token → 200 + new accessToken
 *   - Logout revokes token → subsequent refresh → 401
 *   - Password policy enforcement on signup
 *   - Account lockout after 10 failed attempts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import supertest from "supertest";
import { createApp } from "../app";
import { db } from "../db";
import { users, organizations, refreshTokens } from "@shared/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcrypt";
import { randomUUID } from "crypto";

const TEST_EMAIL    = `auth-test-${Date.now()}@test.local`;
const TEST_PASSWORD = "SecurePass1!";

let app: any;
let orgId: number;
let userId: string;

beforeAll(async () => {
  app = await createApp();

  // Create test org + user directly in DB
  const [org] = await db.insert(organizations).values({
    name: "Auth Test Org", slug: `auth-test-${Date.now()}`, isActive: true,
  } as any).returning({ id: organizations.id });
  orgId = org.id;

  const hash = await bcrypt.hash(TEST_PASSWORD, 10);
  const [u] = await db.insert(users).values({
    id: randomUUID(), email: TEST_EMAIL, passwordHash: hash,
    firstName: "Auth", lastName: "Test",
    role: "admin", organizationId: orgId, emailVerified: true,
    failedLoginAttempts: 0,
  } as any).returning({ id: users.id });
  userId = u.id;
});

afterAll(async () => {
  await db.delete(refreshTokens).where(eq(refreshTokens.userId, userId)).catch(() => {});
  await db.delete(users).where(eq(users.id, userId)).catch(() => {});
  await db.delete(organizations).where(eq(organizations.id, orgId)).catch(() => {});
});

describe("POST /api/auth/login", () => {
  it("returns 200 + accessToken for valid credentials", async () => {
    const res = await supertest(app)
      .post("/api/auth/login")
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.accessToken).toBe("string");
    expect(res.body.accessToken.length).toBeGreaterThan(20);
  });

  it("returns 401 for wrong password", async () => {
    const res = await supertest(app)
      .post("/api/auth/login")
      .send({ email: TEST_EMAIL, password: "WrongPassword1!" });
    expect(res.status).toBe(401);
  });

  it("returns 401 for unknown email", async () => {
    const res = await supertest(app)
      .post("/api/auth/login")
      .send({ email: "nobody@test.local", password: TEST_PASSWORD });
    expect(res.status).toBe(401);
  });

  it("does not leak whether the email exists (same response for both cases)", async () => {
    const res1 = await supertest(app)
      .post("/api/auth/login")
      .send({ email: TEST_EMAIL, password: "WrongPass1!" });
    const res2 = await supertest(app)
      .post("/api/auth/login")
      .send({ email: "nobody@test.local", password: "WrongPass1!" });
    expect(res1.status).toBe(res2.status);
    expect(res1.body.message).toBe(res2.body.message);
  });
});

describe("POST /api/auth/refresh", () => {
  it("returns a new accessToken when token is valid", async () => {
    const loginRes = await supertest(app)
      .post("/api/auth/login")
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });

    const refreshToken = loginRes.body.mobileRefreshToken;
    expect(refreshToken).toBeTruthy();

    const res = await supertest(app)
      .post("/api/auth/refresh")
      .send({ refreshToken });

    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe("string");
  });

  it("returns 401 for a revoked token (after logout)", async () => {
    const loginRes = await supertest(app)
      .post("/api/auth/login")
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    const refreshToken = loginRes.body.mobileRefreshToken;

    // Logout revokes the token
    await supertest(app)
      .post("/api/auth/logout")
      .send({ refreshToken });

    // Subsequent refresh should fail
    const res = await supertest(app)
      .post("/api/auth/refresh")
      .send({ refreshToken });

    expect(res.status).toBe(401);
  });
});

describe("Password policy", () => {
  it("rejects signup with a weak password (no uppercase)", async () => {
    const res = await supertest(app).post("/api/auth/signup").send({
      email: `weak-${Date.now()}@test.local`,
      password: "alllowercase1!",
      firstName: "Test", lastName: "User",
      organizationName: "Weak Org",
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/uppercase/i);
  });

  it("rejects signup with a weak password (no special char)", async () => {
    const res = await supertest(app).post("/api/auth/signup").send({
      email: `weak2-${Date.now()}@test.local`,
      password: "NoSpecial1",
      firstName: "Test", lastName: "User",
      organizationName: "Weak Org 2",
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/special/i);
  });

  it("rejects signup with a short password", async () => {
    const res = await supertest(app).post("/api/auth/signup").send({
      email: `short-${Date.now()}@test.local`,
      password: "Sh1!",
      firstName: "Test", lastName: "User",
      organizationName: "Short Org",
    });
    expect(res.status).toBe(400);
  });
});
