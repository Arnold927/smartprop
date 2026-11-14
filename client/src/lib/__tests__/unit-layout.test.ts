import { describe, it, expect } from "vitest";
import { generateUnits, newGroup, parsePastedUnits, validateUnitRows, groupUnitCount, letterFor, floorLabel, rowToPayload, MAX_UNITS } from "../unit-layout";

describe("generateUnits", () => {
  it("8 floors × 10 units = 80 with floor-based numbers", () => {
    const g = newGroup({ floorFrom: 1, floorTo: 8, perFloor: 10, monthlyRent: "45000" });
    expect(groupUnitCount(g)).toBe(80);
    const rows = generateUnits([g]);
    expect(rows).toHaveLength(80);
    expect(rows[0].unitNumber).toBe("101");
    expect(rows[9].unitNumber).toBe("110");
    expect(rows[79].unitNumber).toBe("810");
    expect(rows[79].floor).toBe("8");
    expect(new Set(rows.map((r) => r.unitNumber)).size).toBe(80);
  });
  it("letter pattern, ground floor and basement labels", () => {
    const rows = generateUnits([newGroup({ floorFrom: -1, floorTo: 1, perFloor: 2, pattern: "floor_letter" })]);
    expect(rows.map((r) => r.unitNumber)).toEqual(["B1A", "B1B", "GA", "GB", "1A", "1B"]);
    expect(rows.map((r) => r.floor)).toEqual(["B1", "B1", "G", "G", "1", "1"]);
  });
  it("sequence pattern continues across floors with a prefix", () => {
    const rows = generateUnits([newGroup({ floorFrom: 1, floorTo: 2, perFloor: 3, pattern: "sequence", prefix: "A-", startAt: 10 })]);
    expect(rows.map((r) => r.unitNumber)).toEqual(["A-10", "A-11", "A-12", "A-13", "A-14", "A-15"]);
  });
  it("two groups with different attributes", () => {
    const rows = generateUnits([
      newGroup({ floorFrom: 1, floorTo: 2, perFloor: 2, bedrooms: "2", monthlyRent: "40000" }),
      newGroup({ floorFrom: 3, floorTo: 3, perFloor: 2, bedrooms: "3", monthlyRent: "60000" }),
    ]);
    expect(rows.map((r) => `${r.unitNumber}:${r.bedrooms}:${r.monthlyRent}`)).toEqual(["101:2:40000", "102:2:40000", "201:2:40000", "202:2:40000", "301:3:60000", "302:3:60000"]);
  });
  it("non-residential types carry no bedrooms and the result is capped", () => {
    const rows = generateUnits([newGroup({ unitType: "retail", floorFrom: 1, floorTo: 100, perFloor: 100 })]);
    expect(rows).toHaveLength(MAX_UNITS);
    expect(rows[0].bedrooms).toBe("");
  });
  it("helpers", () => { expect(letterFor(27)).toBe("AA"); expect(floorLabel(0)).toBe("G"); });
});

describe("parsePastedUnits", () => {
  it("reads a tab-separated sheet with header", () => {
    const { rows } = parsePastedUnits("Unit\tFloor\tType\tBeds\tRent\n101\t1\tApartment\t2\tKES 45,000\n102\t1\tShop\t\t30000");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ unitNumber: "101", floor: "1", unitType: "apartment", bedrooms: "2", monthlyRent: "45000" });
    expect(rows[1]).toMatchObject({ unitType: "retail", monthlyRent: "30000", bedrooms: "" });
  });
  it("reads CSV without a header in the default order", () => {
    const { rows, warnings } = parsePastedUnits("A1,1,apartment,1,1,500,25000\nA2,1,apartment,1,1,500,25000");
    expect(rows).toHaveLength(2); expect(rows[1].monthlyRent).toBe("25000"); expect(warnings[0]).toMatch(/No header/);
  });
  it("handles quoted values and blank lines", () => {
    const { rows } = parsePastedUnits('unit,rent\n"1,A","12,000"\n\n2,5000');
    expect(rows.map((r) => [r.unitNumber, r.monthlyRent])).toEqual([["1,A", "12000"], ["2", "5000"]]);
  });
  it("empty input warns", () => { expect(parsePastedUnits("  \n").warnings.length).toBe(1); });
});

describe("validateUnitRows", () => {
  it("flags blank, duplicate (case-insensitive) and missing rent; passes good rows", () => {
    const rows = generateUnits([newGroup({ floorFrom: 1, floorTo: 1, perFloor: 2, monthlyRent: "100" })]);
    rows.push({ ...rows[0], key: "x", unitNumber: "101" });       // duplicate
    rows.push({ ...rows[0], key: "y", unitNumber: "" });          // blank
    rows.push({ ...rows[0], key: "z", unitNumber: "Z1", monthlyRent: "" }); // no rent
    const v = validateUnitRows(rows);
    expect(v.has(rows[0].key)).toBe(false);
    expect(v.get("x")?.[0].message).toMatch(/row 1/);
    expect(v.get("y")?.[0].field).toBe("unitNumber");
    expect(v.get("z")?.[0].field).toBe("monthlyRent");
  });
  it("per-sqft rows need sqft and rate, not rent", () => {
    const r = generateUnits([newGroup({ floorFrom: 1, floorTo: 1, perFloor: 1, unitType: "retail", rentBasis: "per_sqft", sqft: "400", ratePerSqft: "150" })])[0];
    expect(validateUnitRows([r]).size).toBe(0);
    expect(rowToPayload(r)).toMatchObject({ rentBasis: "per_sqft", sqft: 400, ratePerSqft: 150, monthlyRent: null, bedrooms: null });
    expect(validateUnitRows([{ ...r, sqft: "" }]).size).toBe(1);
  });
});
