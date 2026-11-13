/**
 * Minimal, dependency-free Excel (.xlsx) writer.
 *
 * Why: .csv files do not open on most phones (no app is registered for them),
 * while .xlsx opens in Excel / Google Sheets / the built-in viewers.
 *
 * An .xlsx is a ZIP of XML files. We write an uncompressed ("stored") ZIP,
 * which every spreadsheet app accepts, so no library is needed.
 *
 * Usage:
 *   downloadExcel("tenants-2026-11-13", ["Name", "Rent"], [["Jane", 45000]]);
 *   downloadCsvTextAsExcel("payments", csvStringFromServer);
 */

export type ExcelCell = string | number | boolean | null | undefined | Date;

// ── CRC32 ────────────────────────────────────────────────────────────────────
let CRC_TABLE: Uint32Array | null = null;
function crc32(data: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ── Stored ZIP ───────────────────────────────────────────────────────────────
function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const u16 = (v: number) => new Uint8Array([v & 0xff, (v >>> 8) & 0xff]);
  const u32 = (v: number) => new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);
  const cat = (...parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  };

  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = cat(
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21),
      u32(crc), u32(f.data.length), u32(f.data.length), u16(name.length), u16(0), name, f.data,
    );
    chunks.push(local);
    central.push(cat(
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21),
      u32(crc), u32(f.data.length), u32(f.data.length), u16(name.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), name,
    ));
    offset += local.length;
  }
  const centralBytes = cat(...central);
  const end = cat(
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(centralBytes.length), u32(offset), u16(0),
  );
  return cat(...chunks, centralBytes, end);
}

// ── XML helpers ──────────────────────────────────────────────────────────────
const xmlEsc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    // strip characters that are illegal in XML 1.0
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function sheetNameSafe(name: string): string {
  return (name || "Sheet1").replace(/[\\/?*[\]:]/g, " ").slice(0, 31).trim() || "Sheet1";
}

function buildSheetXml(headers: string[], rows: ExcelCell[][]): string {
  const all: ExcelCell[][] = [headers, ...rows];
  const widths: number[] = [];
  all.forEach((r) =>
    r.forEach((c, i) => {
      const len = c == null ? 0 : c instanceof Date ? 12 : String(c).length;
      widths[i] = Math.min(60, Math.max(widths[i] ?? 8, len + 2));
    }),
  );

  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
  let body = "";
  all.forEach((r, ri) => {
    let cells = "";
    r.forEach((c, ci) => {
      const ref = `${colName(ci)}${ri + 1}`;
      const style = ri === 0 ? ' s="1"' : "";
      if (c == null || c === "") {
        if (ri === 0) cells += `<c r="${ref}"${style}/>`;
      } else if (typeof c === "number" && Number.isFinite(c)) {
        cells += `<c r="${ref}"${style}><v>${c}</v></c>`;
      } else if (typeof c === "boolean") {
        cells += `<c r="${ref}"${style} t="b"><v>${c ? 1 : 0}</v></c>`;
      } else {
        const text = c instanceof Date ? c.toISOString().slice(0, 10) : String(c);
        cells += `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(text)}</t></is></c>`;
      }
    });
    body += `<row r="${ri + 1}">${cells}</row>`;
  });

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${cols}</cols><sheetData>${body}</sheetData></worksheet>`
  );
}

/** Build the .xlsx file bytes. */
export function buildXlsx(headers: string[], rows: ExcelCell[][], sheetName = "Sheet1"): Uint8Array {
  const enc = new TextEncoder();
  const files = [
    {
      name: "[Content_Types].xml",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
      ),
    },
    {
      name: "_rels/.rels",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      ),
    },
    {
      name: "xl/workbook.xml",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEsc(sheetNameSafe(sheetName))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      ),
    },
    {
      name: "xl/styles.xml",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE2F0E9"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
      ),
    },
    { name: "xl/worksheets/sheet1.xml", data: enc.encode(buildSheetXml(headers, rows)) },
  ];
  return zipStore(files);
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Download rows as an Excel file. `filename` may omit the extension. */
export function downloadExcel(filename: string, headers: string[], rows: ExcelCell[][], sheetName?: string) {
  const bytes = buildXlsx(headers, rows, sheetName ?? filename.replace(/\.xlsx?$|\.csv$/i, ""));
  const name = filename.replace(/\.csv$/i, "").replace(/\.xlsx$/i, "") + ".xlsx";
  saveBlob(new Blob([bytes as unknown as BlobPart], { type: XLSX_MIME }), name);
}

// ── CSV text → Excel ─────────────────────────────────────────────────────────

/** Parse CSV text (RFC 4180: quotes, escaped quotes, CRLF, newlines in quotes). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQ = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
      } else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      rows.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/** Turn "45000" / "-12.5" into numbers; keep IDs, phone numbers (+254…, 07…) and dates as text. */
function coerce(v: string): ExcelCell {
  const t = v.trim();
  if (/^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(t)) return Number(t);
  return v;
}

/** Convert CSV text (from a server response or a built string) into an Excel download. */
export function downloadCsvTextAsExcel(filename: string, csvText: string, sheetName?: string) {
  const parsed = parseCsv(csvText);
  const headers = parsed[0] ?? [];
  const rows = parsed.slice(1).map((r) => r.map(coerce));
  downloadExcel(filename, headers, rows, sheetName);
}
