import { describe, expect, it } from "vitest";
import { isQuietHours, nextQuietEnd, timeToMinutes } from "../src/time";

describe("per-user quiet hours", () => {
  it("uses UTC+8 for the default 00:00-07:00 interval", () => {
    expect(isQuietHours(new Date("2026-07-18T15:59:59Z"), 0, 420)).toBe(false);
    expect(isQuietHours(new Date("2026-07-18T16:00:00Z"), 0, 420)).toBe(true);
    expect(isQuietHours(new Date("2026-07-18T22:59:59Z"), 0, 420)).toBe(true);
    expect(isQuietHours(new Date("2026-07-18T23:00:00Z"), 0, 420)).toBe(false);
  });
  it("supports an interval crossing midnight", () => {
    expect(isQuietHours(new Date("2026-07-18T14:30:00Z"), 22 * 60, 8 * 60)).toBe(true);
    expect(isQuietHours(new Date("2026-07-18T04:00:00Z"), 22 * 60, 8 * 60)).toBe(false);
  });
  it("treats equal boundaries as quiet hours disabled", () => {
    expect(isQuietHours(new Date(), 300, 300)).toBe(false);
  });
  it("computes the next default flush", () => {
    expect(nextQuietEnd(new Date("2026-07-18T16:30:00Z"), 0, 420)).toBe("2026-07-18T23:00:00.000Z");
  });
  it("validates HTML time values", () => {
    expect(timeToMinutes("07:30")).toBe(450);
    expect(timeToMinutes("24:00")).toBeNull();
  });
});
