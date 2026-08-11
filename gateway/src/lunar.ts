// 农历转换与事件日期计算（行为与 scripts/notify.py 保持一致）
import { Lunar, LunarYear, Solar } from "lunar-typescript";

export interface FamilyEvent {
  id: string;
  name: string;
  person: string;
  calendar: "lunar" | "solar";
  month: number;
  day: number;
  leap_policy?: "leap_first" | "leap_both" | "normal";
  leap_day_policy?: "feb28" | "mar1";
  birth_year?: number;
  message?: string;
  targets?: string[];
  remind_days?: number[];
}

export interface Occurrence {
  date: Date;      // 发生日的 UTC 零点（用于比较）
  year: number;    // 发生公历年
  isLeap: boolean; // 农历闰月
  age: number | null;
}

const ts = (solar: Solar): number => Date.UTC(solar.getYear(), solar.getMonth() - 1, solar.getDay());

/** 该年该月确实存在该日（防 Solar 溢出规范化） */
function validSolar(year: number, month: number, day: number): boolean {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

function trySolar(year: number, month: number, day: number): Solar | null {
  try { return Solar.fromYmd(year, month, day); } catch { return null; }
}

/** 阳历事件：今天或之后最近一次，处理 2/29 不存在 */
function nextSolar(today: Solar, ev: FamilyEvent): Solar | null {
  for (const year of [today.getYear(), today.getYear() + 1]) {
    let cand = validSolar(year, ev.month, ev.day) ? trySolar(year, ev.month, ev.day) : null;
    if (!cand && ev.month === 2 && ev.day === 29) {
      cand = ev.leap_day_policy === "mar1" ? trySolar(year, 3, 1) : trySolar(year, 2, 28);
    }
    if (cand && ts(cand) >= ts(today)) return cand;
  }
  return null;
}

/**
 * 农历事件：今天或之后最近一次公历日期。
 * leap_first - 当年有闰该月则过闰月，否则正月
 * leap_both  - 与 leap_first 一致（notify.py 实现相同）
 * normal     - 永远按正月过
 */
function nextLunar(today: Solar, ev: FamilyEvent): { solar: Solar; isLeap: boolean } | null {
  const policy = ev.leap_policy ?? "leap_first";
  for (const year of [today.getYear(), today.getYear() + 1]) {
    let candidates: { solar: Solar; isLeap: boolean }[] = [];
    const normal = trySolarFromLunar(year, ev.month, ev.day, false);
    if (normal) candidates.push({ solar: normal, isLeap: false });
    if (policy === "leap_first" || policy === "leap_both") {
      const leapMonth = LunarYear.fromYear(year).getLeapMonth();
      if (leapMonth === ev.month) {
        const leap = trySolarFromLunar(year, ev.month, ev.day, true);
        if (leap) candidates = [{ solar: leap, isLeap: true }];
      }
    }
    const future = candidates
      .filter((c) => ts(c.solar) >= ts(today))
      .sort((a, b) => ts(a.solar) - ts(b.solar));
    if (future.length) return future[0];
  }
  return null;
}

function trySolarFromLunar(year: number, month: number, day: number, isLeap: boolean): Solar | null {
  try { return Lunar.fromYmd(year, isLeap ? -month : month, day).getSolar(); } catch { return null; }
}

export function nextOccurrence(today: Solar, ev: FamilyEvent): Occurrence | null {
  if (ev.calendar === "solar") {
    const solar = nextSolar(today, ev);
    if (!solar) return null;
    return { date: new Date(ts(solar)), year: solar.getYear(), isLeap: false, age: ageAt(ev, solar.getYear()) };
  }
  const found = nextLunar(today, ev);
  if (!found) return null;
  return { date: new Date(ts(found.solar)), year: found.solar.getYear(), isLeap: found.isLeap, age: ageAt(ev, found.solar.getYear()) };
}

function ageAt(ev: FamilyEvent, year: number): number | null {
  return ev.birth_year ? year - ev.birth_year : null;
}

/** 今天日期（Asia/Shanghai 时区）的 Solar */
export function todaySolar(now = new Date()): Solar {
  const utc8 = new Date(now.getTime() + 8 * 3600_000);
  return Solar.fromYmd(utc8.getUTCFullYear(), utc8.getUTCMonth() + 1, utc8.getUTCDate());
}

/** 公历日期 → 农历描述，如「八月十五」/「闰六月十五」 */
export function lunarDescription(date: Date): string {
  const utc8 = new Date(date.getTime() + 8 * 3600_000);
  const lunar = Solar.fromYmd(utc8.getUTCFullYear(), utc8.getUTCMonth() + 1, utc8.getUTCDate()).getLunar();
  return `${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`;
}

/** 公历日期 → 「8月15日 周一」 */
export function solarDescription(date: Date): string {
  const utc8 = new Date(date.getTime() + 8 * 3600_000);
  const solar = Solar.fromYmd(utc8.getUTCFullYear(), utc8.getUTCMonth() + 1, utc8.getUTCDate());
  return `${solar.getMonth()}月${solar.getDay()}日 周${"日一二三四五六"[solar.getWeek()]}`;
}

/** 距今天数（自然日差） */
export function daysUntil(date: Date, now = new Date()): number {
  const a = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const b = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.round((b - a) / 86_400_000);
}
