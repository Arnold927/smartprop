/**
 * client/src/lib/pdf.ts
 *
 * Branded, real-PDF generator for every SmartProp document and report.
 * Produces an actual .pdf file (no print dialog, no pop-up), using the same
 * emerald identity as the on-screen documents in document-theme.ts:
 *   - emerald header band with the SmartProp wordmark, organisation name and
 *     document label / number / issue date
 *   - KPI tiles, section titles, label/value rows, striped tables, totals,
 *     amount box, clause blocks and signature lines
 *   - running header on continuation pages and "Page X of Y" footer
 *
 * jsPDF is loaded on demand, so it never weighs down the main bundle.
 *
 *   const pdf = await createPdf({ title: "Rent receipt", docLabel: "Receipt", docNumber: "RC-1042" });
 *   pdf.section("Payment");
 *   pdf.keyValues([["Tenant", "Jane Wanjiru"], ["Amount", "KES 45,000"]]);
 *   pdf.save("receipt-RC-1042");
 *
 *   await exportTablePdf({ title: "Arrears report", columns: [...], rows: [...] });
 */
import { apiRequest } from "@/lib/queryClient";

// ── Palette (matches SMARTPROP_DOC_CSS) ──────────────────────────────────────
const C = {
  deep:    "#065f46",
  brand:   "#059669",
  mint:    "#a7f3d0",
  mintBg:  "#f0fdf4",
  mintLn:  "#d1fae5",
  ink:     "#1e293b",
  muted:   "#64748b",
  faint:   "#94a3b8",
  line:    "#e2e8f0",
  panel:   "#f8fafc",
  blue:    "#1d4ed8", blueBg: "#eff6ff", blueLn: "#bfdbfe",
  amber:   "#b45309", amberBg: "#fffbeb", amberLn: "#fde68a",
  red:     "#b91c1c", redBg:  "#fef2f2", redLn:  "#fecaca",
} as const;

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Standard PDF fonts only cover WinAnsi; swap anything else for a safe look-alike. */
export function pdfSafe(input: unknown): string {
  const s = input === null || input === undefined ? "" : String(input);
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[→➔]/g, "->")
    .replace(/[✓✔]/g, "Yes")
    .replace(/[✕✖]/g, "No")
    .replace(/ /g, " ")
    // keep Latin-1 + the WinAnsi punctuation block, drop the rest (emoji etc.)
    .replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ–—…•€]/g, "")
    .trim();
}

export function money(n: number | string | null | undefined, currency = "KES"): string {
  const v = parseFloat(String(n ?? 0)) || 0;
  return `${currency} ${Math.round(v).toLocaleString("en-KE")}`;
}

/** Today's date as YYYY-MM-DD in the user's own time zone (toISOString would be UTC and off by a day around midnight in Nairobi). */
export function todayStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function pdfDate(d: string | Date | null | undefined, long = true): string {
  if (!d) return "-";
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return "-";
  return dt.toLocaleDateString("en-KE", { day: "2-digit", month: long ? "long" : "short", year: "numeric" });
}

// ── Organisation branding (cached) ───────────────────────────────────────────
export interface PdfBrand {
  orgName?: string;
  /** Optional org logo as a data URL (png/jpeg). */
  logo?: string;
}

let brandCache: PdfBrand | null = null;
let brandPending: Promise<PdfBrand> | null = null;

async function loadLogo(url?: string | null): Promise<string | undefined> {
  if (!url) return undefined;
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return undefined;
    const blob = await res.blob();
    if (!/^image\/(png|jpe?g)$/i.test(blob.type)) return undefined; // jsPDF handles png/jpeg
    return await new Promise<string>((ok, no) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result));
      r.onerror = () => no(new Error("read"));
      r.readAsDataURL(blob);
    });
  } catch { return undefined; }
}

export async function fetchPdfBrand(): Promise<PdfBrand> {
  if (brandCache) return brandCache;
  if (!brandPending) {
    brandPending = (async () => {
      try {
        const res = await apiRequest("/api/organizations/current");
        const org = await res.json();
        brandCache = { orgName: org?.name || undefined, logo: await loadLogo(org?.logo) };
      } catch {
        brandCache = {};
      }
      return brandCache!;
    })();
  }
  return brandPending;
}

/** Call on logout / org switch so the next document picks up the right name. */
export function resetPdfBrand() { brandCache = null; brandPending = null; }

// ── Builder ──────────────────────────────────────────────────────────────────
export interface PdfOptions {
  /** Used for the file's metadata and the running header. */
  title: string;
  /** Small caps label on the right of the header band, e.g. "Invoice", "Report". */
  docLabel?: string;
  /** Big text under the label, e.g. "INV-2026-0601". Defaults to the title. */
  docNumber?: string;
  issuedDate?: string | Date;
  /** Pre-formatted text for the "Issued:" line (used when converting existing documents). */
  issuedText?: string;
  orientation?: "portrait" | "landscape";
  brand?: PdfBrand;
  /** Replaces the default "computer-generated" footer sentence (e.g. for documents that need signatures). */
  footerNote?: string;
  /** Extra line under the organisation name in the header, e.g. a property name. */
  subtitle?: string;
}

export type Align = "left" | "right" | "center";
export type Tone = "plain" | "green" | "blue" | "amber" | "red";

export interface TableSpec {
  head: string[];
  body: (string | number | null | undefined)[][];
  foot?: (string | number | null | undefined)[][];
  align?: Align[];
  /** Relative column widths (any unit); omitted = automatic. */
  widths?: number[];
  fontSize?: number;
  /** Rows (by index in `body`) to tint, e.g. overdue lines. */
  tint?: Record<number, Tone>;
}

const MARGIN = 15;
const HEADER_H = 30;
const CONT_TOP = 24;      // top margin on continuation pages
const FOOT_H = 14;

export class PdfBuilder {
  doc: any;
  y = 0;
  private W = 210;
  private H = 297;
  private autoTable: any;
  private opts: PdfOptions;
  private brand: PdfBrand;

  constructor(doc: any, autoTable: any, opts: PdfOptions, brand: PdfBrand) {
    this.doc = doc; this.autoTable = autoTable; this.opts = opts; this.brand = brand;
    this.W = doc.internal.pageSize.getWidth();
    this.H = doc.internal.pageSize.getHeight();
    this.drawHeader();
  }

  get contentWidth() { return this.W - MARGIN * 2; }
  private get bottom() { return this.H - FOOT_H - 4; }

  private fill(hex: string) { this.doc.setFillColor(...rgb(hex)); }
  private stroke(hex: string) { this.doc.setDrawColor(...rgb(hex)); }
  private ink(hex: string) { this.doc.setTextColor(...rgb(hex)); }

  private drawHeader() {
    const d = this.doc;
    this.fill(C.deep); d.rect(0, 0, this.W, HEADER_H, "F");
    this.fill(C.brand); d.rect(0, HEADER_H, this.W, 1.2, "F");

    let x = MARGIN;
    if (this.brand.logo) {
      try { d.addImage(this.brand.logo, MARGIN, 6, 18, 18); x = MARGIN + 22; } catch { /* ignore bad logo */ }
    }
    d.setFont("helvetica", "bold"); d.setFontSize(20);
    this.ink("#ffffff"); d.text("Smart", x, 14);
    const sw = d.getTextWidth("Smart");
    this.ink(C.mint); d.text("Prop", x + sw, 14);

    d.setFont("helvetica", "normal"); d.setFontSize(9.5);
    this.ink(C.mint);
    const sub = pdfSafe(this.brand.orgName || "Property Management");
    d.text(sub, x, 20);
    if (this.opts.subtitle) { d.setFontSize(8.5); d.text(pdfSafe(this.opts.subtitle), x, 25, { maxWidth: this.W - MARGIN * 2 - 80 }); }

    const rx = this.W - MARGIN;
    d.setFontSize(7.5); this.ink(C.mint);
    d.text(pdfSafe(this.opts.docLabel || "Document").toUpperCase(), rx, 10, { align: "right" });
    d.setFont("helvetica", "bold"); d.setFontSize(14); this.ink("#ffffff");
    d.text(pdfSafe(this.opts.docNumber || this.opts.title), rx, 17, { align: "right", maxWidth: this.W - MARGIN * 2 - 70 });
    d.setFont("helvetica", "normal"); d.setFontSize(8.5); this.ink("#d1fae5");
    d.text(`Issued: ${pdfSafe(this.opts.issuedText) || pdfDate(this.opts.issuedDate ?? new Date())}`, rx, 23, { align: "right" });

    this.y = HEADER_H + 10;
    // Document title under the band
    d.setFont("helvetica", "bold"); d.setFontSize(15); this.ink(C.ink);
    d.text(pdfSafe(this.opts.title), MARGIN, this.y, { maxWidth: this.contentWidth });
    this.y += 3;
  }

  /** Make sure `h` mm fit on this page; otherwise start a new one. */
  ensure(h: number) {
    if (this.y + h > this.bottom) { this.doc.addPage(); this.y = CONT_TOP; }
  }

  gap(h = 4) { this.y += h; return this; }

  /** A muted one-liner (e.g. "Filters: status = overdue · property = Kileleshwa"). */
  caption(text: string) {
    if (!text) return this;
    const d = this.doc;
    d.setFont("helvetica", "normal"); d.setFontSize(9); this.ink(C.muted);
    const lines = d.splitTextToSize(pdfSafe(text), this.contentWidth);
    this.y += 4; this.ensure(lines.length * 4);
    d.text(lines, MARGIN, this.y); this.y += lines.length * 4;
    return this;
  }

  section(title: string) {
    this.ensure(14);
    const d = this.doc;
    this.y += 6;
    d.setFont("helvetica", "bold"); d.setFontSize(8.5); this.ink(C.brand);
    d.text(pdfSafe(title).toUpperCase(), MARGIN, this.y);
    this.stroke(C.mintLn); d.setLineWidth(0.4);
    d.line(MARGIN, this.y + 1.8, this.W - MARGIN, this.y + 1.8);
    this.y += 6;
    return this;
  }

  paragraph(text: string, o: { bold?: boolean; size?: number; color?: string; align?: Align } = {}) {
    const d = this.doc;
    d.setFont("helvetica", o.bold ? "bold" : "normal"); d.setFontSize(o.size ?? 10);
    this.ink(o.color ?? C.ink);
    const lines: string[] = d.splitTextToSize(pdfSafe(text), this.contentWidth);
    const lh = (o.size ?? 10) * 0.45;
    for (const ln of lines) {
      this.ensure(lh + 1);
      d.text(ln, o.align === "right" ? this.W - MARGIN : o.align === "center" ? this.W / 2 : MARGIN, this.y + lh * 0.8, { align: o.align });
      this.y += lh + 0.6;
    }
    this.y += 1.5;
    return this;
  }

  /** Row of KPI tiles, e.g. Total arrears / Tenants / Oldest balance. */
  kpis(items: { label: string; value: string | number; tone?: Tone }[]) {
    if (!items.length) return this;
    const d = this.doc;
    const perRow = Math.min(items.length, this.W > 250 ? 5 : 4);
    const gap = 3;
    const w = (this.contentWidth - gap * (perRow - 1)) / perRow;
    const h = 16;
    this.y += 5;
    for (let i = 0; i < items.length; i += perRow) {
      this.ensure(h + 2);
      items.slice(i, i + perRow).forEach((k, j) => {
        const tone = k.tone ?? "plain";
        const bg = tone === "green" ? C.mintBg : tone === "blue" ? C.blueBg : tone === "amber" ? C.amberBg : tone === "red" ? C.redBg : C.panel;
        const ln = tone === "green" ? C.mintLn : tone === "blue" ? C.blueLn : tone === "amber" ? C.amberLn : tone === "red" ? C.redLn : C.line;
        const fg = tone === "green" ? C.deep : tone === "blue" ? C.blue : tone === "amber" ? C.amber : tone === "red" ? C.red : C.ink;
        const x = MARGIN + j * (w + gap);
        this.fill(bg); this.stroke(ln); d.setLineWidth(0.3);
        d.roundedRect(x, this.y, w, h, 1.5, 1.5, "FD");
        d.setFont("helvetica", "normal"); d.setFontSize(6.5); this.ink(C.muted);
        d.text(pdfSafe(k.label).toUpperCase(), x + 3, this.y + 5.5, { maxWidth: w - 6 });
        d.setFont("helvetica", "bold"); d.setFontSize(w < 40 ? 11 : 13); this.ink(fg);
        d.text(pdfSafe(k.value), x + 3, this.y + 12.5, { maxWidth: w - 6 });
      });
      this.y += h + gap;
    }
    return this;
  }

  /** Label / value rows, one or two columns, with a ruled line under each. */
  keyValues(rows: [string, unknown][], o: { columns?: 1 | 2; title?: string } = {}) {
    if (o.title) this.section(o.title);
    const d = this.doc;
    const cols = o.columns ?? 1;
    const colGap = 10;
    const colW = (this.contentWidth - colGap * (cols - 1)) / cols;
    const clean = rows.filter(r => r[1] !== undefined && r[1] !== null && String(r[1]) !== "");
    const perCol = Math.ceil(clean.length / cols);
    const rowH = 6.5;
    this.ensure(Math.min(perCol, 6) * rowH);
    const startY = this.y;
    let endY = startY;
    for (let c = 0; c < cols; c++) {
      let y = startY;
      for (const [label, value] of clean.slice(c * perCol, (c + 1) * perCol)) {
        const x = MARGIN + c * (colW + colGap);
        d.setFont("helvetica", "normal"); d.setFontSize(9.5); this.ink(C.muted);
        d.text(pdfSafe(label), x, y + 4.2, { maxWidth: colW * 0.42 });
        d.setFont("helvetica", "bold"); this.ink(C.ink);
        const val: string[] = d.splitTextToSize(pdfSafe(value), colW * 0.56);
        d.text(val, x + colW, y + 4.2, { align: "right" });
        const h = Math.max(rowH, val.length * 4.4 + 2.2);
        this.stroke("#f1f5f9"); d.setLineWidth(0.25); d.line(x, y + h, x + colW, y + h);
        y += h;
      }
      endY = Math.max(endY, y);
    }
    this.y = endY + 2;
    return this;
  }

  /** Two side-by-side panels (e.g. "Bill to" / "Invoice details"). */
  twoColumn(left: { title: string; rows: [string, unknown][] }, right: { title: string; rows: [string, unknown][] }) {
    const d = this.doc;
    const gap = 10;
    const colW = (this.contentWidth - gap) / 2;
    const rowH = 6.5;
    const need = 12 + Math.max(left.rows.length, right.rows.length) * rowH;
    this.ensure(need);
    this.y += 6;
    const top = this.y;
    [left, right].forEach((side, i) => {
      const x = MARGIN + i * (colW + gap);
      d.setFont("helvetica", "bold"); d.setFontSize(8.5); this.ink(C.brand);
      d.text(pdfSafe(side.title).toUpperCase(), x, top);
      this.stroke(C.mintLn); d.setLineWidth(0.4); d.line(x, top + 1.8, x + colW, top + 1.8);
      let y = top + 4;
      for (const [label, value] of side.rows.filter(r => r[1] !== undefined && r[1] !== null && String(r[1]) !== "")) {
        d.setFont("helvetica", "normal"); d.setFontSize(9.5); this.ink(C.muted);
        d.text(pdfSafe(label), x, y + 4.2, { maxWidth: colW * 0.4 });
        d.setFont("helvetica", "bold"); this.ink(C.ink);
        const val: string[] = d.splitTextToSize(pdfSafe(value), colW * 0.58);
        d.text(val, x + colW, y + 4.2, { align: "right" });
        const h = Math.max(rowH, val.length * 4.4 + 2.2);
        this.stroke("#f1f5f9"); d.setLineWidth(0.25); d.line(x, y + h, x + colW, y + h);
        y += h;
      }
      this.y = Math.max(this.y, y);
    });
    this.y += 2;
    return this;
  }

  table(spec: TableSpec) {
    const align = spec.align ?? [];
    const total = (spec.widths ?? []).reduce((a, b) => a + b, 0);
    const colStyles: Record<number, any> = {};
    spec.head.forEach((_, i) => {
      colStyles[i] = { halign: align[i] ?? "left" };
      if (spec.widths && total) colStyles[i].cellWidth = (spec.widths[i] / total) * this.contentWidth;
    });
    const tint = spec.tint ?? {};
    const fs = spec.fontSize ?? (this.W > 250 ? 8 : 8.5);
    this.y += 3;
    this.autoTable(this.doc, {
      startY: this.y,
      head: [spec.head.map(pdfSafe)],
      body: spec.body.map(r => r.map(c => pdfSafe(c))),
      foot: spec.foot?.length ? spec.foot.map(r => r.map(c => pdfSafe(c))) : undefined,
      showFoot: "lastPage",
      theme: "plain",
      margin: { left: MARGIN, right: MARGIN, top: CONT_TOP, bottom: FOOT_H + 6 },
      styles: { font: "helvetica", fontSize: fs, textColor: rgb(C.ink), cellPadding: { top: 2.2, bottom: 2.2, left: 2.5, right: 2.5 }, lineColor: rgb("#f1f5f9"), lineWidth: { bottom: 0.25 }, overflow: "linebreak", valign: "middle" },
      headStyles: { fillColor: rgb(C.deep), textColor: [255, 255, 255], fontStyle: "bold", fontSize: fs - 0.5 },
      footStyles: { fillColor: rgb(C.mintBg), textColor: rgb(C.deep), fontStyle: "bold", lineColor: rgb(C.mintLn), lineWidth: { top: 0.5 } },
      alternateRowStyles: { fillColor: rgb(C.panel) },
      columnStyles: colStyles,
      didParseCell: (data: any) => {
        // column alignment for head/body/foot alike (autotable lets section styles override columnStyles)
        const al = align[data.column.index];
        if (al) data.cell.styles.halign = al;
        if (data.section !== "body") return;
        const t = tint[data.row.index];
        if (!t || t === "plain") return;
        data.cell.styles.fillColor = rgb(t === "red" ? C.redBg : t === "amber" ? C.amberBg : t === "green" ? C.mintBg : C.blueBg);
      },
    });
    this.y = (this.doc.lastAutoTable?.finalY ?? this.y) + 4;
    return this;
  }

  /** Big centred amount (amount due / amount received). */
  amountBox(label: string, amount: string, o: { stamp?: string; tone?: Tone } = {}) {
    const d = this.doc;
    const h = o.stamp ? 34 : 28;
    this.ensure(h + 4);
    this.y += 5;
    const tone = o.tone ?? "green";
    const bg = tone === "red" ? C.redBg : tone === "amber" ? C.amberBg : C.mintBg;
    const ln = tone === "red" ? C.red : tone === "amber" ? C.amber : C.brand;
    const fg = tone === "red" ? C.red : tone === "amber" ? C.amber : C.deep;
    this.fill(bg); this.stroke(ln); d.setLineWidth(0.7);
    d.roundedRect(MARGIN, this.y, this.contentWidth, h, 3, 3, "FD");
    d.setFont("helvetica", "bold"); d.setFontSize(24); this.ink(fg);
    d.text(pdfSafe(amount), this.W / 2, this.y + 13, { align: "center" });
    d.setFont("helvetica", "normal"); d.setFontSize(9); this.ink(ln);
    d.text(pdfSafe(label), this.W / 2, this.y + 20, { align: "center" });
    if (o.stamp) {
      d.setFont("helvetica", "bold"); d.setFontSize(9); this.ink(ln);
      d.text(pdfSafe(o.stamp).toUpperCase(), this.W / 2, this.y + 28, { align: "center" });
    }
    this.y += h + 4;
    return this;
  }

  /** Shaded note box. */
  panel(title: string, lines: string[]) {
    const d = this.doc;
    d.setFont("helvetica", "normal"); d.setFontSize(9.5);
    const wrapped: string[] = lines.flatMap(l => d.splitTextToSize(pdfSafe(l), this.contentWidth - 10));
    const h = 9 + wrapped.length * 4.4;
    this.ensure(h + 3);
    this.y += 3;
    this.fill(C.panel); this.stroke(C.line); d.setLineWidth(0.3);
    d.roundedRect(MARGIN, this.y, this.contentWidth, h, 2, 2, "FD");
    d.setFont("helvetica", "bold"); d.setFontSize(7.5); this.ink(C.muted);
    d.text(pdfSafe(title).toUpperCase(), MARGIN + 5, this.y + 5.5);
    d.setFont("helvetica", "normal"); d.setFontSize(9.5); this.ink("#374151");
    d.text(wrapped, MARGIN + 5, this.y + 10.5);
    this.y += h + 2;
    return this;
  }

  /** Numbered / titled clauses for legal documents (leases, notices). */
  clauses(items: { title?: string; text: string }[]) {
    const d = this.doc;
    for (const c of items) {
      d.setFont("helvetica", "normal"); d.setFontSize(9.5);
      const lines: string[] = d.splitTextToSize(pdfSafe(c.text), this.contentWidth);
      this.ensure((c.title ? 6 : 0) + Math.min(lines.length, 3) * 4.6);
      if (c.title) {
        d.setFont("helvetica", "bold"); d.setFontSize(10); this.ink(C.ink);
        d.text(pdfSafe(c.title), MARGIN, this.y + 4); this.y += 6;
      }
      d.setFont("helvetica", "normal"); d.setFontSize(9.5); this.ink("#374151");
      for (const ln of lines) {
        this.ensure(5);
        d.text(ln, MARGIN, this.y + 3.6); this.y += 4.6;
      }
      this.y += 2.5;
    }
    return this;
  }

  /** Signature lines, e.g. ["Landlord", "Tenant"]. */
  signatures(labels: string[]) {
    const d = this.doc;
    this.ensure(32);
    this.y += 16;
    const gap = 14;
    const w = (this.contentWidth - gap * (labels.length - 1)) / labels.length;
    labels.forEach((l, i) => {
      const x = MARGIN + i * (w + gap);
      this.stroke(C.ink); d.setLineWidth(0.4); d.line(x, this.y, x + w, this.y);
      d.setFont("helvetica", "normal"); d.setFontSize(8.5); this.ink(C.muted);
      d.text(pdfSafe(l), x, this.y + 5);
      d.text("Date: ____________________", x, this.y + 11);
    });
    this.y += 16;
    return this;
  }

  /** Adds running headers + footers to every page, then returns the finished document. */
  finish() {
    const d = this.doc;
    const n = d.getNumberOfPages();
    const stamp = new Date().toLocaleString("en-KE", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    const note = this.opts.footerNote ?? "This is a computer-generated document and does not require a signature.";
    for (let p = 1; p <= n; p++) {
      d.setPage(p);
      if (p > 1) {
        this.fill(C.deep); d.rect(0, 0, this.W, 11, "F");
        this.fill(C.brand); d.rect(0, 11, this.W, 0.8, "F");
        d.setFont("helvetica", "bold"); d.setFontSize(9); this.ink("#ffffff");
        d.text("Smart", MARGIN, 7.2);
        const sw = d.getTextWidth("Smart"); this.ink(C.mint); d.text("Prop", MARGIN + sw, 7.2);
        d.setFont("helvetica", "normal"); d.setFontSize(8); this.ink(C.mint);
        d.text(pdfSafe(`${this.brand.orgName ? this.brand.orgName + "  |  " : ""}${this.opts.title}`), this.W - MARGIN, 7.2, { align: "right", maxWidth: this.W - MARGIN * 2 - 30 });
      }
      this.stroke(C.line); d.setLineWidth(0.3);
      d.line(MARGIN, this.H - FOOT_H, this.W - MARGIN, this.H - FOOT_H);
      d.setFont("helvetica", "normal"); d.setFontSize(7.5); this.ink(C.faint);
      d.text(pdfSafe(note), MARGIN, this.H - FOOT_H + 4.5, { maxWidth: this.contentWidth - 30 });
      d.text(`SmartProp Property Management  |  smartprop.co.ke  |  Generated ${stamp}`, MARGIN, this.H - FOOT_H + 8.5);
      d.setFont("helvetica", "bold"); this.ink(C.muted);
      d.text(`Page ${p} of ${n}`, this.W - MARGIN, this.H - FOOT_H + 4.5, { align: "right" });
    }
    d.setProperties({ title: pdfSafe(this.opts.title), subject: pdfSafe(this.opts.docLabel || "SmartProp document"), creator: "SmartProp", author: pdfSafe(this.brand.orgName || "SmartProp") });
    return d;
  }

  save(filename: string) {
    const name = filename.replace(/[^\w\-. ]+/g, "_").replace(/\.pdf$/i, "");
    this.finish().save(`${name}.pdf`);
  }

  /** The finished PDF as a Blob (e.g. to attach to an email or share sheet). */
  blob(): Blob { return this.finish().output("blob"); }
}

export async function createPdf(opts: PdfOptions): Promise<PdfBuilder> {
  const [{ jsPDF }, atMod, brand] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
    opts.brand ? Promise.resolve(opts.brand) : fetchPdfBrand(),
  ]);
  const autoTable = (atMod as any).autoTable ?? (atMod as any).default;
  const doc = new jsPDF({ orientation: opts.orientation ?? "portrait", unit: "mm", format: "a4", compress: true });
  return new PdfBuilder(doc, autoTable, opts, brand);
}

// ── One-call list/report export ──────────────────────────────────────────────
export interface PdfColumn { header: string; align?: Align; width?: number }

export interface TablePdfInput {
  title: string;
  /** Short description shown under the title: "All properties, overdue > 30 days". */
  caption?: string;
  /** Active filters, listed under the title so the reader knows what the report covers. */
  filters?: string[];
  columns: PdfColumn[];
  rows: (string | number | null | undefined)[][];
  totals?: (string | number | null | undefined)[];
  kpis?: { label: string; value: string | number; tone?: Tone }[];
  docLabel?: string;
  docNumber?: string;
  filename?: string;
  orientation?: "portrait" | "landscape";
  /** Row tint by index (e.g. highlight overdue rows). */
  tint?: Record<number, Tone>;
}

export async function exportTablePdf(input: TablePdfInput) {
  const landscape = input.orientation ? input.orientation === "landscape" : input.columns.length > 6;
  const pdf = await createPdf({
    title: input.title,
    docLabel: input.docLabel ?? "Report",
    docNumber: input.docNumber ?? new Date().toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }),
    orientation: landscape ? "landscape" : "portrait",
  });
  const cap = [input.caption, input.filters?.length ? `Filters: ${input.filters.join("  |  ")}` : ""].filter(Boolean).join("   -   ");
  if (cap) pdf.caption(cap);
  if (input.kpis?.length) pdf.kpis(input.kpis);
  pdf.caption(`${input.rows.length.toLocaleString("en-KE")} record${input.rows.length === 1 ? "" : "s"}`);
  pdf.table({
    head: input.columns.map(c => c.header),
    body: input.rows,
    foot: input.totals ? [input.totals] : undefined,
    align: input.columns.map(c => c.align ?? "left"),
    widths: input.columns.every(c => c.width) ? input.columns.map(c => c.width!) : undefined,
    tint: input.tint,
  });
  const stamp = todayStamp();
  pdf.save(input.filename ?? `${input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${stamp}`);
}
