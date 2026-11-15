/**
 * Phone number normalisation for outbound SMS / WhatsApp.
 *
 * Africa's Talking and Twilio both need E.164 ("+2547…"). Numbers are stored the way people type them
 * ("0712 345 678", "254712345678", "712345678"), so every send path goes through here first.
 * Returns null when the value cannot be a real phone number, so callers can skip it instead of paying for a send that will fail.
 */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let n = String(raw).trim().replace(/[\s\-().]/g, "");
  if (!n) return null;
  if (n.startsWith("00")) n = "+" + n.slice(2);
  if (n.startsWith("+")) {
    const digits = n.slice(1);
    return /^\d{8,15}$/.test(digits) ? "+" + digits : null;
  }
  if (!/^\d+$/.test(n)) return null;
  if (n.startsWith("254") && n.length === 12) return "+" + n;
  if (n.startsWith("0") && n.length === 10) return "+254" + n.slice(1);          // 07xx / 01xx
  if (n.length === 9 && /^[17]/.test(n)) return "+254" + n;                       // 7xx xxx xxx
  return /^\d{10,15}$/.test(n) ? "+" + n : null;                                  // other country code typed without "+"
}
