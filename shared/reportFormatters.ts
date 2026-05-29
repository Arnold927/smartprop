/**
 * shared/reportFormatters.ts
 *
 * Date and currency formatters shared between the landlord-portal client page
 * and the server-side report HTML builder.  Keeping them here ensures the
 * rendered HTML report always matches what the UI shows.
 *
 * No runtime dependencies beyond the JS standard library — safe to import
 * in both Node and browser contexts.
 */

// ─── Date helpers ─────────────────────────────────────────────────────────────

/**
 * Formats a date string as "dd MMM yyyy" (e.g. "04 May 2026").
 * Returns "—" for null / undefined / unparseable input.
 */
export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-KE", {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch {
    return "—";
  }
}

/**
 * Formats a date string as "MMM d" (e.g. "May 4").
 * Returns "—" for null / undefined / unparseable input.
 */
export function fmtDateShort(d: string | Date | null | undefined): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-KE", {
      month: "short", day: "numeric",
    });
  } catch {
    return "—";
  }
}

// ─── Currency helper ──────────────────────────────────────────────────────────

/**
 * Formats a numeric amount as a KES string (e.g. "KES 12,500.00").
 * Accepts a string, number, null, or undefined; treats missing values as 0.
 */
export function fmtKES(val: string | number | null | undefined): string {
  const n = Number(val ?? 0);
  return `KES ${n.toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}