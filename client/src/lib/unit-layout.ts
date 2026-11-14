/**
 * unit-layout.ts — pure helpers behind the "Add property with units" dialog.
 *
 *  - generateUnits(): turns a few "groups" (floors 1–8, 10 units a floor, 2-bed at 45,000 …) into
 *    one row per unit, so an 80-unit building is a handful of fields instead of 80 dialogs.
 *  - parsePastedUnits(): reads rows pasted from Excel / Google Sheets / a CSV file.
 *  - validateUnitRows(): the same rules the server applies, so problems show next to the row.
 *
 * No React in here on purpose — it is easy to test and the server re-validates everything anyway.
 */

export const UNIT_TYPE_OPTIONS = [
  { value: "apartment", label: "Apartment" },
  { value: "house", label: "House" },
  { value: "office", label: "Office" },
  { value: "retail", label: "Retail" },
  { value: "kiosk", label: "Kiosk" },
  { value: "anchor_retail", label: "Anchor retail" },
  { value: "warehouse", label: "Warehouse" },
  { value: "parking", label: "Parking bay" },
  { value: "storage", label: "Storage" },
  { value: "other", label: "Other" },
] as const;

export type UnitTypeValue = (typeof UNIT_TYPE_OPTIONS)[number]["value"];
export type RentBasis = "fixed" | "per_sqft";
export type NumberPattern = "floor_number" | "floor_letter" | "sequence";

export const MAX_UNITS = 500;
export const isResidentialType = (t: string) => t === "apartment" || t === "house";

/** One row of the review grid. Text fields stay strings so half-typed values aren't mangled. */
export interface UnitRow {
  key: string;
  unitNumber: string;
  floor: string;
  unitType: UnitTypeValue;
  bedrooms: string;
  bathrooms: string;
  sqft: string;
  rentBasis: RentBasis;
  ratePerSqft: string;
  monthlyRent: string;
}

export interface UnitGroup {
  id: string;
  floorFrom: number;
  floorTo: number;
  perFloor: number;
  pattern: NumberPattern;
  prefix: string;
  /** "sequence" pattern: the first number. */
  startAt: number;
  unitType: UnitTypeValue;
  bedrooms: string;
  bathrooms: string;
  sqft: string;
  rentBasis: RentBasis;
  ratePerSqft: string;
  monthlyRent: string;
}

let keyCounter = 0;
export const newKey = () => `r${Date.now().toString(36)}${(keyCounter++).toString(36)}`;

export function newGroup(over: Partial<UnitGroup> = {}): UnitGroup {
  return {
    id: newKey(),
    floorFrom: 1,
    floorTo: 4,
    perFloor: 4,
    pattern: "floor_number",
    prefix: "",
    startAt: 1,
    unitType: "apartment",
    bedrooms: "2",
    bathrooms: "1",
    sqft: "",
    rentBasis: "fixed",
    ratePerSqft: "",
    monthlyRent: "",
    ...over,
  };
}

export function blankRow(over: Partial<UnitRow> = {}): UnitRow {
  return {
    key: newKey(), unitNumber: "", floor: "", unitType: "apartment", bedrooms: "", bathrooms: "",
    sqft: "", rentBasis: "fixed", ratePerSqft: "", monthlyRent: "", ...over,
  };
}

/** 0 → "G", negatives → "B1", "B2"…, positives → "1", "2"… */
export function floorLabel(f: number): string {
  if (f === 0) return "G";
  if (f < 0) return `B${Math.abs(f)}`;
  return String(f);
}

/** 1 → A, 26 → Z, 27 → AA … */
export function letterFor(i: number): string {
  let n = i, s = "";
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s || "A";
}

const clampInt = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.trunc(Number.isFinite(n) ? n : lo)));

/** How many units a group produces (so the UI can say "= 80 units" before generating). */
export function groupUnitCount(g: UnitGroup): number {
  const floors = Math.max(0, clampInt(g.floorTo, -50, 200) - clampInt(g.floorFrom, -50, 200) + 1);
  return floors * clampInt(g.perFloor, 0, 500);
}

export function generateUnits(groups: UnitGroup[]): UnitRow[] {
  const rows: UnitRow[] = [];
  for (const g of groups) {
    const from = clampInt(g.floorFrom, -50, 200);
    const to = clampInt(g.floorTo, -50, 200);
    const per = clampInt(g.perFloor, 0, 500);
    let counter = clampInt(g.startAt, 0, 100000);
    for (let f = from; f <= to; f++) {
      for (let i = 1; i <= per; i++) {
        if (rows.length >= MAX_UNITS) return rows;
        const fl = floorLabel(f);
        let unitNumber: string;
        if (g.pattern === "floor_letter") unitNumber = `${g.prefix}${fl}${letterFor(i)}`;
        else if (g.pattern === "sequence") unitNumber = `${g.prefix}${counter++}`;
        else unitNumber = `${g.prefix}${fl}${String(i).padStart(2, "0")}`;
        rows.push({
          key: newKey(), unitNumber, floor: fl, unitType: g.unitType,
          bedrooms: isResidentialType(g.unitType) ? g.bedrooms : "",
          bathrooms: isResidentialType(g.unitType) ? g.bathrooms : "",
          sqft: g.sqft, rentBasis: g.rentBasis, ratePerSqft: g.ratePerSqft, monthlyRent: g.monthlyRent,
        });
      }
    }
  }
  return rows;
}

// ── Pasted / uploaded rows ───────────────────────────────────────────────────────────────────────

const HEADER_ALIASES: Record<string, keyof Omit<UnitRow, "key">> = {
  unit: "unitNumber", unit_number: "unitNumber", unitnumber: "unitNumber", unit_no: "unitNumber", no: "unitNumber", number: "unitNumber", house_no: "unitNumber", name: "unitNumber",
  floor: "floor", level: "floor",
  type: "unitType", unit_type: "unitType",
  bedrooms: "bedrooms", beds: "bedrooms", bed: "bedrooms", br: "bedrooms",
  bathrooms: "bathrooms", baths: "bathrooms", bath: "bathrooms",
  sqft: "sqft", size: "sqft", area: "sqft", sq_ft: "sqft",
  rent: "monthlyRent", monthly_rent: "monthlyRent", rent_kes: "monthlyRent", price: "monthlyRent",
  rate: "ratePerSqft", rate_per_sqft: "ratePerSqft",
  basis: "rentBasis", rent_basis: "rentBasis",
};
const DEFAULT_ORDER: (keyof Omit<UnitRow, "key">)[] = ["unitNumber", "floor", "unitType", "bedrooms", "bathrooms", "sqft", "monthlyRent"];

const normHeader = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/** Splits one line of CSV, honouring "quoted, values". */
function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === sep) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const money = (s: string) => (s ?? "").replace(/[^0-9.]/g, "");

function coerceType(s: string): UnitTypeValue {
  const v = s.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!v) return "apartment";
  const hit = UNIT_TYPE_OPTIONS.find((o) => o.value === v || o.label.toLowerCase().replace(/[\s-]+/g, "_") === v);
  if (hit) return hit.value;
  if (/(^|_)(shop|store|retail)/.test(v)) return "retail";
  if (/(bed|br$|studio|flat|apt)/.test(v)) return "apartment";
  return "other";
}

export interface ParseResult { rows: UnitRow[]; warnings: string[]; }

/** Accepts tab-separated (Excel/Sheets copy) or comma-separated text, with or without a header row. */
export function parsePastedUnits(text: string): ParseResult {
  const warnings: string[] = [];
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim() !== "");
  if (!lines.length) return { rows: [], warnings: ["Nothing to read — paste rows copied from a spreadsheet."] };

  const sep = lines[0].includes("\t") ? "\t" : lines[0].includes(";") && !lines[0].includes(",") ? ";" : ",";
  const grid = lines.map((l) => splitCsvLine(l, sep));

  const first = grid[0].map(normHeader);
  const hasHeader = first.some((h) => h in HEADER_ALIASES) && first.some((h) => HEADER_ALIASES[h] === "unitNumber");
  let cols: (keyof Omit<UnitRow, "key"> | null)[];
  let dataRows = grid;
  if (hasHeader) {
    cols = first.map((h) => HEADER_ALIASES[h] ?? null);
    dataRows = grid.slice(1);
    const ignored = grid[0].filter((_, i) => !cols[i]);
    if (ignored.length) warnings.push(`Ignored columns: ${ignored.filter(Boolean).join(", ")}`);
  } else {
    cols = DEFAULT_ORDER.slice(0, grid[0].length);
    warnings.push("No header row found — read the columns as: unit, floor, type, bedrooms, bathrooms, sqft, rent.");
  }

  const rows: UnitRow[] = [];
  for (const cells of dataRows) {
    if (rows.length >= MAX_UNITS) { warnings.push(`Only the first ${MAX_UNITS} rows were read.`); break; }
    const r = blankRow();
    cols.forEach((c, i) => {
      const v = (cells[i] ?? "").trim();
      if (!c || v === "") return;
      switch (c) {
        case "unitType": r.unitType = coerceType(v); break;
        case "rentBasis": r.rentBasis = /sq/i.test(v) ? "per_sqft" : "fixed"; break;
        case "bedrooms": case "sqft": r[c] = v.replace(/[^0-9]/g, ""); break;
        case "bathrooms": case "monthlyRent": case "ratePerSqft": r[c] = money(v); break;
        default: r[c] = v;
      }
    });
    if (!r.unitNumber && !r.monthlyRent && !r.floor) continue; // blank-ish line
    if (!isResidentialType(r.unitType)) { r.bedrooms = ""; r.bathrooms = ""; }
    rows.push(r);
  }
  if (!rows.length) warnings.push("No usable rows found.");
  return { rows, warnings };
}

/** CSV the user can fill in and paste/upload back. */
export const UNIT_TEMPLATE_CSV =
  "unit,floor,type,bedrooms,bathrooms,sqft,rent\n" +
  "101,1,apartment,2,2,900,45000\n" +
  "102,1,apartment,2,2,900,45000\n" +
  "201,2,apartment,3,2,1200,60000\n" +
  "G01,G,retail,,,500,75000\n";

// ── Validation (mirrors the server) ──────────────────────────────────────────────────────────────

export interface RowProblem { field?: keyof Omit<UnitRow, "key">; message: string }

/** key → problems. Rows with no entry are fine. */
export function validateUnitRows(rows: UnitRow[]): Map<string, RowProblem[]> {
  const out = new Map<string, RowProblem[]>();
  const add = (k: string, p: RowProblem) => out.set(k, [...(out.get(k) ?? []), p]);
  const firstSeen = new Map<string, number>();
  rows.forEach((r, i) => {
    const num = r.unitNumber.trim();
    if (!num) add(r.key, { field: "unitNumber", message: "Unit number is required" });
    else {
      const k = num.toLowerCase();
      if (firstSeen.has(k)) add(r.key, { field: "unitNumber", message: `Same number as row ${firstSeen.get(k)}` });
      else firstSeen.set(k, i + 1);
    }
    if (r.floor.length > 20) add(r.key, { field: "floor", message: "Floor is too long" });
    if (r.rentBasis === "per_sqft") {
      if (!(parseInt(r.sqft) > 0)) add(r.key, { field: "sqft", message: "Sqft is needed for rate-per-sqft rent" });
      if (!(parseFloat(r.ratePerSqft) > 0)) add(r.key, { field: "ratePerSqft", message: "Rate per sqft is needed" });
    } else if (r.monthlyRent.trim() === "" || isNaN(parseFloat(r.monthlyRent))) {
      add(r.key, { field: "monthlyRent", message: "Rent is required" });
    }
  });
  return out;
}

export function rowRent(r: UnitRow): number {
  if (r.monthlyRent.trim() !== "" && !isNaN(parseFloat(r.monthlyRent))) return parseFloat(r.monthlyRent);
  if (r.rentBasis === "per_sqft") return (parseInt(r.sqft) || 0) * (parseFloat(r.ratePerSqft) || 0);
  return 0;
}

/** Row → the JSON the server expects. */
export function rowToPayload(r: UnitRow) {
  const num = (s: string) => (s.trim() === "" || isNaN(Number(s)) ? null : Number(s));
  return {
    unitNumber: r.unitNumber.trim(),
    floor: r.floor.trim() || null,
    unitType: r.unitType,
    bedrooms: isResidentialType(r.unitType) ? num(r.bedrooms) : null,
    bathrooms: isResidentialType(r.unitType) ? num(r.bathrooms) : null,
    sqft: num(r.sqft),
    rentBasis: r.rentBasis,
    ratePerSqft: r.rentBasis === "per_sqft" ? num(r.ratePerSqft) : null,
    monthlyRent: r.monthlyRent.trim() === "" ? null : num(r.monthlyRent),
  };
}
