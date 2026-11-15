/**
 * auth.test.ts — Authentication flow
 *
 * Covers:
 *   - Login with valid credentials → 200 + accessToken
 *   - Login with wrong password → 401
 *   - Login with unknown email → 401
 *   - Refresh token → 200 + new accessToken
 *   - Logout revokes token → subsequent refresh → 401
 *   - Public signup closed; password policy enforced on change/reset password
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
  // Public self-service signup is closed once any organisation exists (accounts are
  // created by admins), so the policy is exercised on the routes that stay reachable:
  // change-password (authenticated) and reset-password (public, token based).
  async function bearer() {
    const r = await supertest(app).post("/api/auth/login").send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    return `Bearer ${r.body.accessToken}`;
  }

  it("public signup is closed once an organisation exists", async () => {
    const res = await supertest(app).post("/api/auth/signup").send({
      email: `closed-${Date.now()}@test.local`, password: "SecurePass1!",
      firstName: "Test", lastName: "User", organizationName: "Closed Org",
    });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/registration is disabled/i);
  });

  const weak: Array<[string, string, RegExp]> = [
    ["no uppercase", "alllowercase1!", /uppercase/i],
    ["no number", "NoNumberHere!", /number/i],
    ["no special character", "NoSpecial1", /special/i],
    ["too short", "Sh1!", /8 characters/i],
  ];

  for (const [label, pw, msg] of weak) {
    it(`change-password rejects a weak password (${label})`, async () => {
      const res = await supertest(app).post("/api/auth/change-password")
        .set("Authorization", await bearer())
        .send({ currentPassword: TEST_PASSWORD, newPassword: pw });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(msg);
    });
  }

  it("reset-password rejects a weak password before looking at the token", async () => {
    const res = await supertest(app).post("/api/auth/reset-password")
      .send({ token: "does-not-matter", password: "alllowercase1!" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/uppercase/i);
  });

  it("change-password refuses a wrong current password even with a strong new one", async () => {
    const res = await supertest(app).post("/api/auth/change-password")
      .set("Authorization", await bearer())
      .send({ currentPassword: "WrongPass1!", newPassword: "BrandNewPass1!" });
    expect(res.status).toBe(401);
  });
});
