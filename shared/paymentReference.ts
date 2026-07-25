/**
 * shared/paymentReference.ts
 *
 * Single source of truth for the M-Pesa account-reference format used to
 * identify which invoice/bill a payment is for. Previously this format was
 * a hardcoded string literal duplicated in three places (the tenant portal,
 * the STK initiate fallback, and the C2B confirmation parser) — consistent
 * by convention only, with nothing enforcing agreement between them. This
 * module is the one place the format is defined; everything else imports it.
 *
 * Format:
 *   Rent:    INV-{rentPaymentId}
 *   Utility: UTIL-{utilityBillId}
 *
 * Daraja's AccountReference field is capped at 12 characters. Both builders
 * truncate to that length explicitly — Safaricom would truncate a longer
 * value anyway, but doing it here guarantees what's sent is exactly what the
 * parser below can read back, with no silent mismatch.
 */

const MAX_REFERENCE_LENGTH = 12;

export function buildRentAccountReference(rentPaymentId: number): string {
  return `INV-${rentPaymentId}`.slice(0, MAX_REFERENCE_LENGTH);
}

export function buildUtilityAccountReference(utilityBillId: number): string {
  return `UTIL-${utilityBillId}`.slice(0, MAX_REFERENCE_LENGTH);
}

export type ParsedAccountReference =
  | { kind: "utility"; id: number }
  | { kind: "rent"; id: number }
  | null;

/**
 * Parses an incoming M-Pesa account reference (e.g. from a C2B webhook, or a
 * manual Paybill payment where the tenant typed it in) and returns which
 * record it identifies, if any.
 *
 * Utility is checked FIRST and exclusively — a reference either explicitly
 * tags a utility bill or it doesn't; it must never fall through and get
 * misread as a rent invoice id. Both patterns are anchored (^...$) so a
 * reference like "TEN-45" (a tenant id, not an invoice id) can't have its
 * digits misread as a rentPaymentId — only an exact "INV-42"/"INV42"/"42"
 * shape matches the rent case.
 */
export function parseAccountReference(ref: string): ParsedAccountReference {
  const trimmed = ref.trim();

  const utilMatch = trimmed.match(/^UTIL-?(\d+)$/i);
  if (utilMatch) return { kind: "utility", id: parseInt(utilMatch[1], 10) };

  const invMatch = trimmed.match(/^(?:INV-?)?(\d+)$/i);
  if (invMatch) return { kind: "rent", id: parseInt(invMatch[1], 10) };

  return null;
}