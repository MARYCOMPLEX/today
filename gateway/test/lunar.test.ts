import { describe, expect, it } from "vitest";
import { daysUntil, lunarDescription, nextOccurrence, solarDescription, todaySolar, type FamilyEvent } from "../src/lunar";

const lunarMom: FamilyEvent = { id: "mom", name: "妈妈生日", person: "妈妈", calendar: "lunar", month: 8, day: 15, leap_policy: "leap_first", birth_year: 1962 };
const solarAnniv: FamilyEvent = { id: "anniv", name: "结婚纪念日", person: "爸妈", calendar: "solar", month: 10, day: 1, birth_year: 1988 };
const feb29: FamilyEvent = { id: "kid", name: "孩子生日", person: "宝宝", calendar: "solar", month: 2, day: 29, birth_year: 2020 };

describe("lunar events", () => {
  it("2026-08-11 前后：农历 8/15 落在 2026-09-25（中秋）", () => {
    const solar = todaySolar(new Date("2026-08-11T04:00:00Z"));
    const occ = nextOccurrence(solar, lunarMom);
    expect(occ).not.toBeNull();
    expect(occ!.date.toISOString().slice(0, 10)).toBe("2026-09-25");
    expect(occ!.age).toBe(64);
  });

  it("闰月策略：2025 年闰六月，农历 6/15 应过闰月（08-08）", () => {
    const ev: FamilyEvent = { id: "leap", name: "闰月生日", person: "测试", calendar: "lunar", month: 6, day: 15, leap_policy: "leap_first" };
    const solar = todaySolar(new Date("2025-01-01T04:00:00Z"));
    const occ = nextOccurrence(solar, ev);
    expect(occ).not.toBeNull();
    expect(occ!.date.toISOString().slice(0, 10)).toBe("2025-08-08");
    expect(occ!.isLeap).toBe(true);
  });

  it("normal 策略不过闰月", () => {
    const ev: FamilyEvent = { id: "leap2", name: "闰月生日", person: "测试", calendar: "lunar", month: 6, day: 15, leap_policy: "normal" };
    const solar = todaySolar(new Date("2025-01-01T04:00:00Z"));
    const occ = nextOccurrence(solar, ev);
    expect(occ).not.toBeNull();
    expect(occ!.date.toISOString().slice(0, 10)).toBe("2025-07-09");
    expect(occ!.isLeap).toBe(false);
  });

  it("阳历 10/1 今年未过则取今年", () => {
    const solar = todaySolar(new Date("2026-08-11T04:00:00Z"));
    const occ = nextOccurrence(solar, solarAnniv);
    expect(occ!.date.toISOString().slice(0, 10)).toBe("2026-10-01");
  });

  it("阳历 2/29 无闰年取 2/28（feb28 策略）", () => {
    const solar = todaySolar(new Date("2026-01-05T04:00:00Z"));
    const occ = nextOccurrence(solar, feb29);
    expect(occ).not.toBeNull();
    expect(occ!.date.toISOString().slice(0, 10)).toBe("2026-02-28");
  });

  it("阳历 2/29 闰年取当天", () => {
    const solar = todaySolar(new Date("2028-01-05T04:00:00Z"));
    const occ = nextOccurrence(solar, feb29);
    expect(occ!.date.toISOString().slice(0, 10)).toBe("2028-02-29");
  });

  it("daysUntil 计算自然日差", () => {
    expect(daysUntil(new Date("2026-08-16T00:00:00Z"), new Date("2026-08-11T04:00:00Z"))).toBe(5);
    expect(daysUntil(new Date("2026-08-11T00:00:00Z"), new Date("2026-08-11T04:00:00Z"))).toBe(0);
  });

  it("农历描述", () => {
    expect(lunarDescription(new Date("2026-09-25T00:00:00Z"))).toBe("八月十五");
  });

  it("公历描述含星期", () => {
    expect(solarDescription(new Date("2026-09-25T00:00:00Z"))).toBe("9月25日 周五");
  });
});
