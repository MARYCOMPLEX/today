// 添加日期功能：临时 token 校验、事件字段校验、GitHub 写回
import { sha256Hex } from "./crypto";
import { appendEvent } from "./github";
import type { Env } from "./types";

export const ADD_EVENT_TTL_MS = 15 * 60 * 1000;

export interface NewEventInput {
  name: string;
  person: string;
  calendar: "lunar" | "solar";
  month: number;
  day: number;
  leap_policy: "leap_first" | "leap_both" | "normal";
  leap_day_policy: "feb28" | "mar1";
  birth_year?: number;
  message?: string;
}

type ClaimResult = { ok: true; userId: string } | { ok: false; error: string };

export async function claimAddToken(env: Env, token: string, consume: boolean, kind: "add" | "delete" = "add"): Promise<ClaimResult> {
  if (!token) return { ok: false, error: "缺少 token 参数，请在微信发送相应命令获取链接。" };
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    "SELECT user_id, expires_at, consumed_at, kind FROM add_event_token WHERE token_hash = ?"
  ).bind(tokenHash).first<{ user_id: string; expires_at: number; consumed_at: number | null; kind: string }>();
  if (!row) return { ok: false, error: "链接无效，请重新在微信发送相应命令。" };
  if (row.kind !== kind) return { ok: false, error: "链接类型不匹配，请重新在微信发送相应命令。" };
  if (row.consumed_at !== null) return { ok: false, error: "该链接已被使用过，请重新在微信发送相应命令。" };
  if (row.expires_at <= Date.now()) return { ok: false, error: "链接已过期，请重新在微信发送相应命令。" };
  if (consume) {
    const result = await env.DB.prepare(
      "UPDATE add_event_token SET consumed_at = ? WHERE token_hash = ? AND consumed_at IS NULL"
    ).bind(Date.now(), tokenHash).run();
    if (result.meta.changes !== 1) return { ok: false, error: "该链接已被使用过，请重新在微信发送相应命令。" };
  }
  return { ok: true, userId: row.user_id };
}

function toInt(value: unknown): number | null {
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number.parseInt(value, 10);
  if (typeof value === "number" && Number.isInteger(value)) return value;
  return null;
}

export function validateEventInput(raw: Record<string, unknown>): { ok: true; value: NewEventInput } | { ok: false; error: string } {
  const name = String(raw.name ?? "").trim();
  const person = String(raw.person ?? "").trim();
  const calendarRaw = String(raw.calendar ?? "").trim();
  const calendar = calendarRaw === "solar" ? "solar" : calendarRaw === "lunar" ? "lunar" : null;
  const month = toInt(raw.month);
  const day = toInt(raw.day);
  const leapRaw = String(raw.leap_policy ?? "leap_first").trim();
  const leapPolicy = leapRaw === "normal" || leapRaw === "leap_both" || leapRaw === "leap_first" ? leapRaw : null;
  const leapDayRaw = String(raw.leap_day_policy ?? "feb28").trim();
  const leapDayPolicy = leapDayRaw === "feb28" || leapDayRaw === "mar1" ? leapDayRaw : null;
  const birthYear = raw.birth_year === undefined || raw.birth_year === null || String(raw.birth_year).trim() === ""
    ? undefined : toInt(raw.birth_year);
  const message = raw.message === undefined ? undefined : String(raw.message).trim();

  if (!name) return { ok: false, error: "请填写事件名称（如：妈妈生日）" };
  if (!person) return { ok: false, error: "请填写人物（如：妈妈）" };
  if (!calendar) return { ok: false, error: "历法必须是 农历 或 阳历" };
  if (month === null || month < 1 || month > 12) return { ok: false, error: "月份必须在 1-12" };
  const maxDay = calendar === "lunar" ? 30 : 31;
  if (day === null || day < 1 || day > maxDay) return { ok: false, error: `日期必须在 1-${maxDay}（农历最大 30）` };
  if (calendar === "lunar" && !leapPolicy) return { ok: false, error: "闰月策略必须是 normal / leap_first / leap_both" };
  if (calendar === "solar" && !(month === 2 && day === 29) && leapDayPolicy === null) return { ok: false, error: "2 月 29 日策略无效" };
  if (calendar === "solar" && month === 2 && day === 29 && leapDayPolicy === null) return { ok: false, error: "请选择 2 月 29 日不存在时的处理方式" };
  if (birthYear !== undefined && (birthYear === null || birthYear < 1900 || birthYear > 2100)) return { ok: false, error: "出生年份必须在 1900-2100" };
  if (message !== undefined && message.length > 500) return { ok: false, error: "消息模板不能超过 500 字" };

  return {
    ok: true,
    value: {
      name, person, calendar,
      month, day,
      leap_policy: calendar === "lunar" ? leapPolicy! : "leap_first",
      leap_day_policy: calendar === "solar" && month === 2 && day === 29 ? leapDayPolicy! : "feb28",
      birth_year: birthYear,
      message: message || undefined,
    },
  };
}

export function buildEvent(input: NewEventInput): Record<string, unknown> {
  const event: Record<string, unknown> = {
    id: crypto.randomUUID(),
    name: input.name,
    person: input.person,
    calendar: input.calendar,
    month: input.month,
    day: input.day,
  };
  if (input.calendar === "lunar") event.leap_policy = input.leap_policy;
  if (input.calendar === "solar" && input.month === 2 && input.day === 29) event.leap_day_policy = input.leap_day_policy;
  if (input.birth_year !== undefined) event.birth_year = input.birth_year;
  if (input.message) event.message = input.message;
  return event;
}

export async function addEventFromForm(env: Env, input: NewEventInput): Promise<void> {
  await appendEvent(env, buildEvent(input));
}
