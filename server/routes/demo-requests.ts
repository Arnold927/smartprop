/**
 * Public demo request — the form at the bottom of the landing page.
 *
 * Anonymous, so it is small and defensive: strict field checks, a per-connection limit, a hidden "website" field that real
 * people never fill (bots do), and nothing about the SmartProp team or other customers in the reply.
 */
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { sendDemoRequestEmail } from "../lib/email";

export const demoRequestsRouter = Router();

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: () => Number(process.env.DEMO_REQUEST_LIMIT ?? 10),
  message: { message: "Too many requests from this connection. Please try again later, or message us on WhatsApp." },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === "test",
});

const PORTFOLIOS = ["1-10 units", "11-50 units", "51-200 units", "200+ units", "Gated estate / mall", "Diaspora investor"] as const;
const clean = (max: number) => z.string().trim().max(max);

const schema = z.object({
  name: clean(100).min(2, "Please enter your name."),
  phone: clean(25).regex(/^[+\d][\d\s()-]{6,}$/, "Enter a phone number we can reach you on."),
  email: clean(120).email("Enter a valid email address.").optional().or(z.literal("").transform(() => undefined)),
  portfolio: z.enum(PORTFOLIOS).optional().or(z.literal("").transform(() => undefined)),
  message: clean(1000).optional(),
  website: z.string().optional(),     // honeypot
});

demoRequestsRouter.post("/", limiter, async (req, res) => {
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Please check the form." });
  const { website, ...data } = parsed.data;
  // A bot filled the hidden field: answer as if it worked, send nothing.
  if (website) return res.status(201).json({ received: true, emailSent: true });
  try {
    const emailSent = await sendDemoRequestEmail(data);
    if (!emailSent) console.warn(`[demo-request] no DEMO_REQUEST_TO/RESEND_API_KEY configured, request not delivered: ${data.name} ${data.phone}`);
    return res.status(201).json({ received: true, emailSent });
  } catch (err) {
    console.error("[demo-request] email failed:", err);
    return res.status(201).json({ received: true, emailSent: false });
  }
});
