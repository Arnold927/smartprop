/**
 * ai-proxy.ts — mounted at /api/ai
 *
 * Proxies chat requests to the Anthropic API so the API key
 * never has to leave the server. The virtual-assistant page
 * sends its messages here instead of calling api.anthropic.com directly.
 *
 * Endpoint:
 *   POST /api/ai/chat
 *     Body: { system: string, messages: {role, content}[], max_tokens?: number }
 *     Returns: { reply: string }
 *
 * Rate limit: 20 requests per user per minute (generous for a chat UI,
 * prevents runaway loops or abuse).
 */

import { Router } from "express";
import { z } from "zod";
import { authenticateJWT } from "../middleware/auth";
import { requireOrg } from "../middleware/requireOrg";

const router = Router();
const auth = [authenticateJWT as any, requireOrg as any];

// ── Per-user in-memory rate limiter (resets on server restart — good enough) ──
const userRequestLog = new Map<string, number[]>();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX       = 20;

function isRateLimited(userId: string): boolean {
  const now  = Date.now();
  const hits  = (userRequestLog.get(userId) ?? []).filter(t => now - t < RATE_WINDOW_MS);
  hits.push(now);
  userRequestLog.set(userId, hits);
  return hits.length > RATE_MAX;
}

// ── Validation ────────────────────────────────────────────────────────────────

const chatSchema = z.object({
  system: z.string().max(4000),
  messages: z.array(z.object({
    role:    z.enum(["user", "assistant"]),
    content: z.string().max(2000),
  })).min(1).max(20),
  max_tokens: z.number().int().min(100).max(1500).optional().default(1000),
});

// ── POST /api/ai/chat ─────────────────────────────────────────────────────────

router.post("/chat", ...auth, async (req: any, res: any) => {
  try {
    // Rate limit check
    if (isRateLimited(req.user.id)) {
      return res.status(429).json({ message: "Too many AI requests. Please wait a moment." });
    }

    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({ message: "Invalid request", errors: parsed.error.flatten().fieldErrors });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error("[ai-proxy] ANTHROPIC_API_KEY not set");
      return res.status(503).json({ message: "AI service is not configured on this server." });
    }

    const { system, messages, max_tokens } = parsed.data;

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:      "claude-sonnet-4-20250514",
        max_tokens,
        system,
        messages,
      }),
    });

    if (!anthropicRes.ok) {
      const errBody = await anthropicRes.text().catch(() => "");
      console.error("[ai-proxy] Anthropic error:", anthropicRes.status, errBody);
      return res.status(502).json({ message: "AI service returned an error. Please try again." });
    }

    const data = await anthropicRes.json() as any;
    const reply = data?.content?.[0]?.text ?? "";

    if (!reply) {
      return res.status(502).json({ message: "AI service returned an empty response." });
    }

    res.json({ reply });
  } catch (err) {
    console.error("[ai-proxy] Unexpected error:", err);
    res.status(500).json({ message: "AI service unavailable. Please try again." });
  }
});

export default router;
