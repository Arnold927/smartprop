import { describe, it, expect } from "vitest";
import { parseAnimatable, formatAnimated, timeGreeting } from "../feel";

describe("parseAnimatable (what the count-up animates)", () => {
  it("finds the number inside KES amounts, percentages and plain counts", () => {
    expect(parseAnimatable("KES 1,250,000")).toEqual({ prefix: "KES ", n: 1250000, decimals: 0, suffix: "" });
    expect(parseAnimatable("94%")).toEqual({ prefix: "", n: 94, decimals: 0, suffix: "%" });
    expect(parseAnimatable("12")).toEqual({ prefix: "", n: 12, decimals: 0, suffix: "" });
    expect(parseAnimatable("4.5 days")).toEqual({ prefix: "", n: 4.5, decimals: 1, suffix: " days" });
    expect(parseAnimatable(7)).toMatchObject({ n: 7, decimals: 0 });
  });
  it("leaves text without a clean number alone", () => {
    expect(parseAnimatable("—")).toBeNull();
    expect(parseAnimatable("N/A")).toBeNull();
    expect(parseAnimatable("KES 1.2M")).toMatchObject({ prefix: "KES ", n: 1.2, suffix: "M" });
    expect(parseAnimatable("2026-11-16")).toBeNull();
    expect(parseAnimatable(Number.NaN)).toBeNull();
  });
});

describe("formatAnimated", () => {
  it("groups thousands like the original text and keeps decimals", () => {
    expect(formatAnimated(1250000, 0, true)).toBe("1,250,000");
    expect(formatAnimated(1234.5, 1, true)).toBe("1,234.5");
    expect(formatAnimated(999, 0, true)).toBe("999");
    expect(formatAnimated(45000.4, 0, false)).toBe("45000");
  });
});

describe("timeGreeting", () => {
  it("follows the hour", () => {
    expect(timeGreeting(new Date(2026, 10, 16, 8))).toBe("Good morning");
    expect(timeGreeting(new Date(2026, 10, 16, 13))).toBe("Good afternoon");
    expect(timeGreeting(new Date(2026, 10, 16, 20))).toBe("Good evening");
  });
});
