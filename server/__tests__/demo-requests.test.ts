import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const send = vi.fn();
vi.mock("../lib/email", () => ({ sendDemoRequestEmail: (...a: any[]) => send(...a) }));
import { demoRequestsRouter } from "../routes/demo-requests";

const app = express();
app.use(express.json());
app.use("/api/public/demo-request", demoRequestsRouter);
const ok = { name: "Jane Wanjiru", phone: "0712 345 678" };

describe("public demo request", () => {
  beforeEach(() => { send.mockReset(); send.mockResolvedValue(true); });

  it("accepts a valid request and emails the team", async () => {
    const r = await request(app).post("/api/public/demo-request").send({ ...ok, email: "j@x.co", portfolio: "11-50 units" });
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ received: true, emailSent: true });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).toMatchObject({ name: "Jane Wanjiru", email: "j@x.co" });
  });
  it("rejects a missing name, bad phone, bad email and unknown portfolio", async () => {
    for (const bad of [{ phone: ok.phone }, { ...ok, phone: "abc" }, { ...ok, email: "nope" }, { ...ok, portfolio: "everything" }, { ...ok, name: "x".repeat(101) }]) {
      const r = await request(app).post("/api/public/demo-request").send(bad);
      expect(r.status).toBe(400);
      expect(typeof r.body.message).toBe("string");
    }
    expect(send).not.toHaveBeenCalled();
  });
  it("silently drops bot submissions that fill the honeypot", async () => {
    const r = await request(app).post("/api/public/demo-request").send({ ...ok, website: "http://spam" });
    expect(r.status).toBe(201);
    expect(send).not.toHaveBeenCalled();
  });
  it("still answers 201 with emailSent=false when the email is not configured or fails", async () => {
    send.mockResolvedValueOnce(false);
    expect((await request(app).post("/api/public/demo-request").send(ok)).body.emailSent).toBe(false);
    send.mockRejectedValueOnce(new Error("resend down"));
    const r = await request(app).post("/api/public/demo-request").send(ok);
    expect(r.status).toBe(201); expect(r.body.emailSent).toBe(false);
  });
});
