/**
 * client/src/lib/document-theme.ts
 *
 * Shared print-document theme for all SmartProp PDF/print documents.
 * Provides unified CSS and helper to open a print window.
 *
 * All document generators (receipts, invoices, leases, RRT notices,
 * certificates, portfolio reports) import from here so the visual
 * identity stays consistent and changes only need to be made once.
 */

export const SMARTPROP_DOC_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', Arial, sans-serif;
    font-size: 13px;
    color: #1e293b;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page { max-width: 800px; margin: 0 auto; padding: 40px; }

  /* ── Header ──────────────────────────────────────────────── */
  .sp-header {
    background: linear-gradient(135deg, #065f46 0%, #059669 100%);
    padding: 24px 32px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin: -40px -40px 32px -40px;
  }
  .sp-brand { color: #fff; font-size: 22px; font-weight: 800; letter-spacing: -0.5px; line-height: 1; }
  .sp-brand-sub { color: #a7f3d0; font-size: 11px; font-weight: 400; margin-top: 3px; }
  .sp-doc-meta { text-align: right; color: #fff; }
  .sp-doc-label { font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; color: #a7f3d0; margin-bottom: 4px; }
  .sp-doc-number { font-size: 18px; font-weight: 700; }
  .sp-doc-date { font-size: 11px; color: #d1fae5; margin-top: 3px; }

  /* ── Section titles ──────────────────────────────────────── */
  .sp-section { margin-bottom: 24px; }
  .sp-section-title {
    font-size: 9px; font-weight: 700; letter-spacing: 1.5px;
    text-transform: uppercase; color: #059669;
    border-bottom: 1.5px solid #d1fae5; padding-bottom: 5px; margin-bottom: 10px;
  }

  /* ── Row pairs (label / value) ───────────────────────────── */
  .sp-row {
    display: flex; justify-content: space-between; align-items: baseline;
    padding: 5px 0; border-bottom: 1px solid #f1f5f9; font-size: 13px;
  }
  .sp-label { color: #64748b; }
  .sp-value { font-weight: 600; text-align: right; }

  /* ── Two-column grid ─────────────────────────────────────── */
  .sp-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px; }

  /* ── Amount / total box ──────────────────────────────────── */
  .sp-amount-box {
    background: #f0fdf4; border: 2px solid #059669; border-radius: 12px;
    padding: 20px 24px; margin: 24px 0; text-align: center;
  }
  .sp-amount { font-size: 38px; font-weight: 800; color: #065f46; letter-spacing: -1px; line-height: 1; }
  .sp-amount-label { font-size: 12px; color: #047857; margin-top: 6px; }
  .sp-stamp {
    display: inline-block; border: 3px solid #059669; border-radius: 6px;
    padding: 6px 18px; color: #059669; font-weight: 800; font-size: 13px;
    letter-spacing: 2px; transform: rotate(-3deg); margin-top: 10px;
  }

  /* ── KPI cards (for reports) ─────────────────────────────── */
  .sp-kpi-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 14px; margin-bottom: 24px; }
  .sp-kpi { border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; background: #f8fafc; }
  .sp-kpi .lbl { font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; margin-bottom: 6px; }
  .sp-kpi .val { font-size: 20px; font-weight: 700; color: #0f172a; }
  .sp-kpi.green { background: #f0fdf4; border-color: #d1fae5; }
  .sp-kpi.green .val { color: #065f46; }
  .sp-kpi.blue  { background: #eff6ff; border-color: #bfdbfe; }
  .sp-kpi.blue  .val { color: #1d4ed8; }

  /* ── Tables ──────────────────────────────────────────────── */
  .sp-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  .sp-table th {
    font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px;
    color: #64748b; padding: 8px 12px; border-bottom: 2px solid #d1fae5;
    text-align: left; background: #f8fafc;
  }
  .sp-table th.r, .sp-table td.r { text-align: right; }
  .sp-table td { padding: 9px 12px; border-bottom: 1px solid #f1f5f9; font-size: 13px; }
  .sp-table tr.sp-total td { font-weight: 700; border-top: 2px solid #d1fae5; background: #f8fafc; }
  .sp-table tr.sp-net   td { font-weight: 700; font-size: 14px; color: #065f46; border-top: 2px solid #d1fae5; background: #f0fdf4; }

  /* ── Info panel (shaded box) ─────────────────────────────── */
  .sp-panel {
    background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;
    padding: 16px 20px; margin-bottom: 20px;
  }
  .sp-panel-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; margin-bottom: 8px; }

  /* ── Print button (hidden when printing) ─────────────────── */
  .sp-print-btn {
    background: #059669; color: #fff; border: none; padding: 10px 24px;
    border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer;
    display: block; margin-bottom: 24px;
  }

  /* ── Clause blocks (for legal docs) ─────────────────────── */
  .sp-clause { margin-bottom: 12px; font-size: 12px; line-height: 1.7; color: #374151; }
  .sp-clause-title { font-weight: 700; color: #1e293b; margin-bottom: 3px; }

  /* ── Signature block ─────────────────────────────────────── */
  .sp-sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 32px; }
  .sp-sig-line { border-top: 1.5px solid #1e293b; padding-top: 6px; margin-top: 40px; font-size: 11px; color: #64748b; }

  /* ── Footer ──────────────────────────────────────────────── */
  .sp-footer {
    margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 14px;
    font-size: 10px; color: #94a3b8; text-align: center;
  }

  /* ── Print / page rules ──────────────────────────────────── */
  @media print {
    .sp-print-btn { display: none !important; }
    .page { padding: 0; }
    .sp-header { margin: 0 0 28px 0; border-radius: 0; }
  }
  @page { margin: 14mm; }
`;

/**
 * Opens a new print window with the SmartProp theme applied,
 * writes the provided body HTML into it, then triggers the print dialog.
 *
 * @param bodyHtml   The inner HTML to render (no <html>/<head> wrapper needed)
 * @param title      Document title shown in the print dialog / PDF filename
 * @param extraCss   Optional extra CSS appended after the shared theme
 */
export function openPrintWindow(bodyHtml: string, title: string, extraCss = ""): void {
  const win = window.open("", "_blank");
  if (!win) {
    alert("Please allow pop-ups to download this document as PDF.");
    return;
  }
  win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>${title}</title>
  <style>${SMARTPROP_DOC_CSS}${extraCss}</style>
</head>
<body>
<div class="page">
  <button class="sp-print-btn" onclick="window.print()">&#8595; Save as PDF &nbsp;(File &rarr; Print &rarr; Save as PDF)</button>
  ${bodyHtml}
</div>
</body>
</html>`);
  win.document.close();
  win.onload = () => { win.focus(); win.print(); };
}

/** Helper: format a date string as "02 January 2025" */
export function fmtDocDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-KE", { day: "2-digit", month: "long", year: "numeric" });
  } catch { return "—"; }
}

/** Helper: format a number as KES with comma separator */
export function fmtDocKES(amount: number | string | null | undefined, currency = "KES"): string {
  const n = parseFloat(String(amount ?? 0)) || 0;
  return `${currency} ${Math.round(n).toLocaleString("en-KE")}`;
}

/** SmartProp emerald header HTML — same on every document */
export function spHeader(docLabel: string, docNumber: string, issuedDate = new Date().toISOString(), orgName?: string): string {
  return `
  <div class="sp-header">
    <div>
      <div class="sp-brand">Smart<span style="color:#a7f3d0">Prop</span></div>
      <div class="sp-brand-sub">${orgName ?? "Property Management"}</div>
    </div>
    <div class="sp-doc-meta">
      <div class="sp-doc-label">${docLabel}</div>
      <div class="sp-doc-number">${docNumber}</div>
      <div class="sp-doc-date">Issued: ${fmtDocDate(issuedDate)}</div>
    </div>
  </div>`;
}

/** SmartProp standard footer */
export function spFooter(extra = ""): string {
  return `
  <div class="sp-footer">
    This is a computer-generated document and does not require a signature. ${extra}
    &nbsp;&middot;&nbsp; SmartProp Property Management System
    &nbsp;&middot;&nbsp; smartprop.co.ke
  </div>`;
}