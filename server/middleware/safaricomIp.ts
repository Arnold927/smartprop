/**
 * safaricomIp — middleware that restricts M-Pesa webhook endpoints to
 * Safaricom's published server IP ranges.
 *
 * Safaricom's current ranges (as of 2025):
 *   https://developer.safaricom.co.ke/Documentation
 *
 * Usage:
 *   router.post('/callback', safaricomIpOnly, async (req, res) => { ... })
 *
 * How it resolves the real client IP:
 *   - In production behind Nginx/Caddy/a load balancer, Express must have
 *     `app.set('trust proxy', 1)` set (already done in app.ts for IS_PROD).
 *     req.ip will then be the first X-Forwarded-For value — the real caller.
 *   - In dev/sandbox mode (MPESA_ENVIRONMENT !== 'production') the check is
 *     skipped entirely so local testing and ngrok tunnels keep working.
 */

import { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger.js";

// Safaricom's published IP ranges for callback delivery.
// Sources:
//   - https://developer.safaricom.co.ke/Documentation (Callback IP Whitelist)
//   - Daraja API integration guide (2024 edition)
// Update this list if Safaricom publishes new ranges.
const SAFARICOM_CIDR_BLOCKS = [
  "196.201.214.0/24",
  "196.201.214.128/25",
  "196.201.215.0/24",
  "196.201.215.128/25",
  "196.201.212.0/23",
  "196.201.213.0/24",
];

/** Convert a CIDR string to a { base, mask } pair for fast matching. */
function parseCidr(cidr: string): { base: number; mask: number } {
  const [ip, bits] = cidr.split("/");
  const base = ipToInt(ip);
  const mask = bits ? (~0 << (32 - parseInt(bits, 10))) >>> 0 : 0xffffffff;
  return { base: base & mask, mask };
}

function ipToInt(ip: string): number {
  return ip
    .split(".")
    .reduce((acc, octet) => (acc << 8) | parseInt(octet, 10), 0) >>> 0;
}

const ALLOWED_RANGES = SAFARICOM_CIDR_BLOCKS.map(parseCidr);

function isAllowed(ip: string): boolean {
  // Strip IPv6-mapped IPv4 prefix (::ffff:196.201.214.1)
  const clean = ip.replace(/^::ffff:/, "");
  // Allow loopback unconditionally (integration tests, health checks)
  if (clean === "127.0.0.1" || clean === "::1") return true;

  try {
    const intIp = ipToInt(clean);
    return ALLOWED_RANGES.some(
      ({ base, mask }) => (intIp & mask) >>> 0 === base
    );
  } catch {
    return false;
  }
}

/**
 * Express middleware — blocks requests whose source IP is not in Safaricom's
 * published callback ranges.
 *
 * In sandbox mode (MPESA_ENVIRONMENT !== 'production') the check is bypassed
 * so developers can test with ngrok or local simulators.
 */
export function safaricomIpOnly(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Bypass in non-production so devs can test locally / via ngrok
  if (process.env.MPESA_ENVIRONMENT !== "production") {
    return next();
  }

  const ip = req.ip ?? "";

  if (isAllowed(ip)) {
    return next();
  }

  logger.warn(
    `[safaricomIp] Blocked M-Pesa callback from disallowed IP — ip=${ip} path=${req.path}`
  );

  // Always return 200 to Safaricom even on rejection — a non-200 triggers
  // Safaricom's retry logic which would hammer the endpoint.
  // We silently drop the request instead.
  res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
}