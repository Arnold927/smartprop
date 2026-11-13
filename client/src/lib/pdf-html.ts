/**
 * client/src/lib/pdf-html.ts
 *
 * Turns SmartProp's themed document HTML (the `sp-*` markup produced by
 * document-theme.ts, and the equivalent markup the server builds for RRT
 * notices) into a real, branded PDF download using lib/pdf.ts.
 *
 * Every existing "Download" button that used to open the browser's print
 * dialog can call `downloadDocPdf(bodyHtml, title)` instead and get an actual
 * .pdf file, with no pop-up and the same professional layout on phone and
 * desktop.
 */
import { createPdf, pdfSafe, type PdfBuilder, type TableSpec } from "@/lib/pdf";

const has = (el: Element, ...names: string[]) => names.some(n => el.classList.contains(n));
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? "").replace(/\s+/g, " ").trim();

/** textContent that keeps <br> as line breaks. */
function textWithBreaks(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll("br").forEach(br => br.replaceWith("\n"));
  return (clone.textContent ?? "").replace(/[ \t]+/g, " ").replace(/\n\s+/g, "\n").trim();
}

function rowsOf(container: Element): [string, string][] {
  const out: [string, string][] = [];
  container.querySelectorAll(":scope > .sp-row, :scope > .row").forEach(r => {
    const label = r.querySelector(".sp-label, .label");
    const value = r.querySelector(".sp-value, .value");
    if (label && value) out.push([text(label), text(value)]);
  });
  return out;
}

function tableOf(t: Element): TableSpec | null {
  const head = Array.from(t.querySelectorAll("thead th")).map(th => text(th));
  if (!head.length) return null;
  const align = Array.from(t.querySelectorAll("thead th")).map(th => (th.classList.contains("r") ? "right" : "left") as "left" | "right");
  const body: string[][] = [];
  const foot: string[][] = [];
  t.querySelectorAll("tbody tr").forEach(tr => {
    const cells: string[] = [];
    tr.querySelectorAll("td").forEach(td => {
      cells.push(text(td));
      const span = parseInt(td.getAttribute("colspan") || "1", 10);
      for (let i = 1; i < span; i++) cells.push("");
    });
    while (cells.length < head.length) cells.push("");
    (has(tr, "sp-total", "sp-net") ? foot : body).push(cells.slice(0, head.length));
  });
  return { head, body, foot, align };
}

interface Ctx { pdf: PdfBuilder; footerNote?: string }

function sectionBlock(ctx: Ctx, el: Element) {
  const { pdf } = ctx;
  const title = el.querySelector(":scope > .sp-section-title, :scope > .section-title");
  if (title) pdf.section(text(title));
  walkChildren(ctx, el, title);
}

function walkChildren(ctx: Ctx, parent: Element, skip?: Element | null) {
  const { pdf } = ctx;
  const kids = Array.from(parent.children).filter(k => k !== skip);

  // Consecutive label/value rows are drawn as one block
  let pendingRows: [string, string][] = [];
  const flushRows = () => { if (pendingRows.length) { pdf.keyValues(pendingRows); pendingRows = []; } };

  for (const el of kids) {
    const tag = el.tagName.toLowerCase();
    if (has(el, "sp-print-btn") || tag === "button" || tag === "style" || tag === "script" || tag === "hr") continue;

    if (has(el, "sp-row", "row")) {
      const label = el.querySelector(".sp-label, .label");
      const value = el.querySelector(".sp-value, .value");
      if (label && value) { pendingRows.push([text(label), text(value)]); continue; }
    }
    flushRows();

    if (has(el, "sp-header")) continue; // handled once, up front
    if (has(el, "sp-section-title", "section-title")) { pdf.section(text(el)); continue; }
    if (has(el, "sp-footer", "footer")) { continue; }

    if (has(el, "sp-grid-2", "grid-2")) {
      const cols = Array.from(el.children);
      const parsed = cols.map(c => ({
        title: text(c.querySelector(".sp-section-title, .section-title")) || "",
        rows: rowsOf(c.querySelector(".sp-section-title, .section-title") ? c : c),
        el: c,
      }));
      if (cols.length === 2 && parsed.every(c => c.rows.length > 0)) {
        pdf.twoColumn({ title: parsed[0].title, rows: parsed[0].rows }, { title: parsed[1].title, rows: parsed[1].rows });
      } else {
        cols.forEach(c => sectionBlock(ctx, c));
      }
      continue;
    }

    if (has(el, "sp-section", "section")) { sectionBlock(ctx, el); continue; }

    if (has(el, "sp-amount-box")) {
      pdf.amountBox(text(el.querySelector(".sp-amount-label")), text(el.querySelector(".sp-amount")), { stamp: text(el.querySelector(".sp-stamp")) || undefined });
      continue;
    }
    if (has(el, "amount-box")) {
      const items = Array.from(el.querySelectorAll(".amount-item")).map(i => ({
        label: text(i.querySelector(".amount-label")),
        value: text(i.querySelector(".amount-value")),
        tone: "amber" as const,
      }));
      if (items.length) { pdf.kpis(items); continue; }
    }

    if (has(el, "sp-kpi-grid")) {
      const items = Array.from(el.querySelectorAll(".sp-kpi")).map(k => ({
        label: text(k.querySelector(".lbl")), value: text(k.querySelector(".val")),
        tone: (k.classList.contains("green") ? "green" : k.classList.contains("blue") ? "blue" : "plain") as any,
      }));
      pdf.kpis(items); continue;
    }

    if (has(el, "sp-table") || tag === "table") {
      const spec = tableOf(el);
      if (spec) { pdf.table(spec); continue; }
    }

    if (has(el, "sp-panel") && el.querySelector(":scope > div > h3")) {
      const pairs: [string, string][] = Array.from(el.querySelectorAll(":scope > div")).map(d => [text(d.querySelector("h3")), text(d.querySelector("p"))] as [string, string]).filter(r => r[0] && r[1]);
      if (pairs.length) { pdf.keyValues(pairs, { columns: pairs.length > 1 ? 2 : 1 }); continue; }
    }

    if (has(el, "sp-panel", "highlight", "warning-box")) {
      const title = text(el.querySelector(".sp-panel-title, .warning-title"));
      const rows = rowsOf(el);
      if (rows.length && !title) { pdf.keyValues(rows); continue; }
      if (el.querySelector(".sp-grid-2, .sp-row")) {
        if (title) pdf.paragraph(title, { bold: true, size: 9 });
        walkChildren(ctx, el, el.querySelector(".sp-panel-title, .warning-title")); continue;
      }
      const lines: string[] = [];
      el.querySelectorAll(":scope > p, :scope > .clause-block, :scope > .sp-clause, :scope > div:not(.warning-title):not(.sp-panel-title)").forEach(l => lines.push(textWithBreaks(l)));
      if (!lines.length) lines.push(textWithBreaks(el).replace(title, "").trim());
      pdf.panel(title || "Note", lines.filter(Boolean));
      continue;
    }

    if (has(el, "sp-clause", "clause-block")) {
      const ttl = el.querySelector(".sp-clause-title");
      if (ttl) {
        const rest = textWithBreaks(el).replace(text(ttl), "").trim();
        pdf.clauses([{ title: text(ttl), text: rest }]);
      } else {
        pdf.clauses([{ text: textWithBreaks(el) }]);
      }
      continue;
    }

    if (has(el, "sp-sig-grid", "sig-grid")) {
      const labels = Array.from(el.children).map(b => {
        const name = text(b.querySelector(".sp-section-title, .sig-role")) || "Signature";
        const who = text(b.querySelector(".sig-name")) || text(b.querySelector("div[style*='font-weight:700']"));
        return who ? `${name}: ${who}` : name;
      });
      pdf.signatures(labels); continue;
    }

    if (tag === "p") { const t = textWithBreaks(el); if (t) pdf.paragraph(t); continue; }
    if (/^h[1-6]$/.test(tag)) { pdf.paragraph(text(el), { bold: true, size: 12 }); continue; }
    if (tag === "ul" || tag === "ol") {
      Array.from(el.querySelectorAll(":scope > li")).forEach((li, i) => pdf.paragraph(`${tag === "ol" ? i + 1 + "." : "-"} ${text(li)}`));
      continue;
    }

    // Plain wrapper: look inside; otherwise treat as a text line
    if (el.children.length) { walkChildren(ctx, el); continue; }
    const t = textWithBreaks(el);
    if (t) pdf.paragraph(t);
  }
  flushRows();
}

/** Read the document-level header (label, number, issue date, property/org line). */
function readHeader(root: Element) {
  const header = root.querySelector(".sp-header");
  if (!header) return {};
  const left = header.children[0];
  const right = header.children[header.children.length - 1];
  const rightTexts = right ? Array.from(right.children).map(c => text(c)).filter(Boolean) : [];
  const leftTexts = left ? Array.from(left.children).map(c => text(c)).filter(t => t && !/^SmartProp$/i.test(t)) : [];
  const dateLine = (t: string) => /^(issued|generated)/i.test(t);
  const issued = rightTexts.find(dateLine)?.replace(/^(issued|generated):?\s*/i, "");
  const real = rightTexts.filter(t => !dateLine(t) && !/^RRT NOTICE$/i.test(t));
  return {
    label: real[0],
    number: real[1],
    issuedText: issued,
    subtitle: leftTexts.join("  |  "),
  };
}

/**
 * Build and download a PDF from themed document HTML.
 * Accepts a full HTML document (server-built notices) or a body fragment.
 * Throws if nothing recognisable was found so callers can fall back to printing.
 */
export async function htmlToPdfDownload(html: string, title: string, filename?: string) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const root = parsed.querySelector(".page") ?? parsed.body;
  const head = readHeader(root);

  const pdf = await createPdf({
    title: pdfSafe(title.replace(/\s*[-–—]\s*[A-Z0-9-]{4,}$/, "")) || title,
    docLabel: head.label || "Document",
    docNumber: head.number || title,
    issuedText: head.issuedText,
    subtitle: head.subtitle || undefined,
  });

  const footer = root.querySelector(".sp-footer, .footer");
  const ctx: Ctx = { pdf };
  const before = pdf.y;
  walkChildren(ctx, root);
  if (pdf.y === before && !root.textContent?.trim()) throw new Error("empty document");

  if (footer) {
    // The PDF footer already carries the standard sentence and SmartProp line; keep only extra text.
    const note = textWithBreaks(footer)
      .replace(/This is a computer-generated document and does not require a signature\.?/i, "")
      .replace(/SmartProp Property Management( System)?/i, "")
      .replace(/smartprop\.co\.ke/i, "")
      .replace(/[\s\u00B7|]+$/g, "").replace(/^[\s\u00B7|]+/g, "")
      .replace(/\s*[\u00B7|]\s*[\u00B7|]\s*/g, "  |  ")
      .trim();
    if (note.length > 3) pdf.paragraph(note, { size: 8, color: "#64748b" });
  }
  pdf.save(filename || title);
}
