// 微信常用命令（纯规则匹配，无大模型）
import { randomClientId, randomToken, sha256Hex } from "./crypto";
import { fetchEvents } from "./github";
import { sendTextMessage } from "./ilink";
import { daysUntil, lunarDescription, nextOccurrence, todaySolar, type FamilyEvent } from "./lunar";
import { minutesToTime } from "./time";
import type { Env } from "./types";

const MAX_TEXT = 4000;
const PUSH_TIMES = "每天 7:30 / 12:30 / 19:30";

export interface CommandContext {
  env: Env;
  userId: string;
  baseUrl: string;
  botToken: string;
  toUserId: string;
  contextToken: string;
}

const dayLabel = (days: number): string => days === 0 ? "今天" : days === 1 ? "明天" : `${days} 天后`;

function eventIcon(ev: FamilyEvent): string {
  return ev.calendar === "lunar" ? "🌙" : "☀️";
}

function formatEvent(ev: FamilyEvent, days: number): string {
  const icon = eventIcon(ev);
  const cal = ev.calendar === "lunar" ? "农历" : "阳历";
  return `${icon} ${ev.name}（${ev.person}）${cal} ${ev.month}月${ev.day}日`;
}

async function sendChunks(ctx: CommandContext, lines: string[]): Promise<void> {
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > MAX_TEXT && current) { chunks.push(current); current = line; }
    else current = candidate;
  }
  if (current) chunks.push(current);
  for (const [index, chunk] of chunks.entries()) {
    await sendTextMessage({
      baseUrl: ctx.baseUrl,
      token: ctx.botToken,
      toUserId: ctx.toUserId,
      contextToken: ctx.contextToken,
      clientId: randomClientId(),
      text: chunks.length > 1 ? `（${index + 1}/${chunks.length}）\n${chunk}` : chunk,
    });
  }
}

async function reply(ctx: CommandContext, lines: string[]): Promise<void> {
  await sendChunks(ctx, lines);
}

/** 生成临时 token 链接（add / delete） */
async function createTokenLink(ctx: CommandContext, kind: "add" | "delete"): Promise<string> {
  const token = randomToken(kind === "add" ? "add_" : "del_");
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  await ctx.env.DB.prepare(
    `INSERT INTO add_event_token (id, user_id, token_hash, kind, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(crypto.randomUUID(), ctx.userId, tokenHash, kind, now + 15 * 60_000, now).run();
  await ctx.env.DB.prepare("DELETE FROM add_event_token WHERE user_id = ? AND expires_at <= ?").bind(ctx.userId, now).run();
  const origin = ctx.env.PUBLIC_ORIGIN ?? "https://today.gojia.cloud";
  return `${origin}/${kind === "add" ? "add-event" : "manage-events"}?token=${encodeURIComponent(token)}`;
}

async function loadEvents(ctx: CommandContext): Promise<FamilyEvent[]> {
  const data = await fetchEvents(ctx.env);
  return (data.events ?? []) as unknown as FamilyEvent[];
}

// ---------- 各命令 ----------

export async function cmdAddDate(ctx: CommandContext): Promise<void> {
  const link = await createTokenLink(ctx, "add");
  await reply(ctx, [
    "📅 添加日期链接已生成（15 分钟内有效，一次性使用）：",
    "",
    link,
    "",
    "点开链接填写：名称、人物、农历/阳历、月、日，提交后自动写入日历。",
  ]);
}

export async function cmdDeleteDate(ctx: CommandContext): Promise<void> {
  const link = await createTokenLink(ctx, "delete");
  await reply(ctx, [
    "🗑️ 删除日期链接已生成（15 分钟内有效，一次性使用）：",
    "",
    link,
    "",
    "点开链接勾选要删除的事件，提交后自动从日历移除。",
  ]);
}

export async function cmdListEvents(ctx: CommandContext): Promise<void> {
  const events = await loadEvents(ctx);
  if (!events.length) {
    await reply(ctx, ["📋 家庭日历目前还没有登记任何事件。发送「添加日期」开始添加吧。"]);
    return;
  }
  const lines = [`📋 家庭日历（共 ${events.length} 条）：`, ""];
  for (const ev of events) lines.push(formatEvent(ev, 0));
  lines.push("", "发送「最近」查看未来 5 天，发送「添加日期」/「删除日期」管理事件。");
  await reply(ctx, lines);
}

async function upcomingLines(ctx: CommandContext, horizonDays: number, title: string): Promise<string[] | null> {
  const events = await loadEvents(ctx);
  const today = todaySolar();
  const found: { ev: FamilyEvent; days: number; occ: NonNullable<ReturnType<typeof nextOccurrence>> }[] = [];
  for (const ev of events) {
    const occ = nextOccurrence(today, ev);
    if (!occ) continue;
    const days = daysUntil(occ.date);
    if (days >= 0 && days <= horizonDays) found.push({ ev, days, occ });
  }
  found.sort((a, b) => a.days - b.days);
  if (!found.length) return null;
  const lines = [title, ""];
  for (const { ev, days, occ } of found) {
    const extra: string[] = [];
    if (occ.isLeap) extra.push("闰月");
    if (occ.age !== null) extra.push(`${occ.age} 岁`);
    const lunar = ev.calendar === "lunar" ? `（农历 ${lunarDescription(occ.date)}）` : "";
    const meta = extra.length ? `｜${extra.join("，")}` : "";
    lines.push(`${dayLabel(days)} ${formatEvent(ev, days)}${lunar}${meta}`);
  }
  return lines;
}

export async function cmdToday(ctx: CommandContext): Promise<void> {
  const lines = await upcomingLines(ctx, 0, "📌 今天");
  await reply(ctx, lines ?? ["😌 今天没有特别的日子，好好休息。"]);
}

export async function cmdUpcoming(ctx: CommandContext): Promise<void> {
  const lines = await upcomingLines(ctx, 5, `📅 未来 5 天（含今天）`);
  await reply(ctx, lines ?? ["😌 未来 5 天没有特别的日子。"]);
}

export async function cmdTest(ctx: CommandContext): Promise<void> {
  const now = new Date(Date.now() + 8 * 3600_000).toISOString().slice(11, 16);
  await reply(ctx, [`✅ 命令链路正常（${now}），微信推送可用。`]);
}

export async function cmdStatus(ctx: CommandContext): Promise<void> {
  const [binding, settings, events] = await Promise.all([
    ctx.env.DB.prepare("SELECT status, last_poll_at, last_error FROM wechat_binding WHERE user_id = ?").bind(ctx.userId).first<{ status: string; last_poll_at: number | null; last_error: string | null }>(),
    ctx.env.DB.prepare("SELECT quiet_start_minutes, quiet_end_minutes FROM notification_settings WHERE user_id = ?").bind(ctx.userId).first<{ quiet_start_minutes: number; quiet_end_minutes: number }>(),
    loadEvents(ctx).catch(() => []),
  ]);
  const statusText: Record<string, string> = {
    active: "✅ 正常", pending_context: "⏳ 等待 init", reauth_required: "⚠️ 需重新绑定",
  };
  const quiet = settings ? `${minutesToTime(settings.quiet_start_minutes)} - ${minutesToTime(settings.quiet_end_minutes)}` : "未设置";
  const lastPoll = binding?.last_poll_at ? new Date(binding.last_poll_at + 8 * 3600_000).toISOString().replace("T", " ").slice(0, 19) : "从未";
  await reply(ctx, [
    "📊 家庭日历状态",
    `绑定：${statusText[binding?.status ?? ""] ?? "未绑定"}`,
    `最近轮询：${lastPoll}`,
    `静默时段：${quiet}`,
    `推送时段：${PUSH_TIMES}`,
    `已登记事件：${events.length} 条`,
    binding?.last_error ? `最近错误：${binding.last_error}` : "",
  ].filter(Boolean));
}

export async function cmdAdmin(ctx: CommandContext): Promise<void> {
  const user = await ctx.env.DB.prepare("SELECT email FROM user WHERE id = ?").bind(ctx.userId).first<{ email: string }>();
  const origin = ctx.env.PUBLIC_ORIGIN ?? "https://today.gojia.cloud";
  await reply(ctx, [
    "🌐 管理后台：",
    `${origin}/dashboard`,
    "",
    `👤 登录账号：${user?.email ?? "（未找到账号）"}`,
    "🔑 密码：注册时设置的密码（登录后可自行修改）",
    "",
    "后台可查看：API Key、微信绑定状态、通知/静默时段、创建邀请码。",
  ]);
}

export async function cmdHelp(ctx: CommandContext): Promise<void> {
  await reply(ctx, [
    "🤖 可用命令：",
    "init — 激活 / 确认绑定",
    "添加日期 — 生成临时链接，在线添加事件",
    "删除日期 — 生成临时链接，在线删除事件",
    "日历 — 查看全部已登记事件",
    "今天 — 查看今天的事件",
    "最近 — 查看未来 5 天（含今天）的事件",
    "测试 — 发送一条测试消息",
    "状态 — 查看绑定、推送与静默时段",
    "后台 — 获取管理后台入口与登录账号",
    "帮助 — 显示本说明",
  ]);
}

const COMMAND_TABLE: { keys: string[]; handler: (ctx: CommandContext) => Promise<void> }[] = [
  { keys: ["添加日期", "新增日期", "add", "add-date", "adddate"], handler: cmdAddDate },
  { keys: ["删除日期", "删除", "del", "delete", "remove"], handler: cmdDeleteDate },
  { keys: ["日历", "列表", "events", "list", "全部"], handler: cmdListEvents },
  { keys: ["今天", "today"], handler: cmdToday },
  { keys: ["最近", "近期", "upcoming", "soon", "future"], handler: cmdUpcoming },
  { keys: ["测试", "test", "ping"], handler: cmdTest },
  { keys: ["状态", "status"], handler: cmdStatus },
  { keys: ["后台", "管理后台", "admin", "dashboard", "面板"], handler: cmdAdmin },
  { keys: ["帮助", "help", "命令", "commands", "菜单"], handler: cmdHelp },
];

/** 返回是否匹配并处理了命令 */
export async function handleCommand(ctx: CommandContext, rawText: string): Promise<boolean> {
  const text = rawText.trim().toLowerCase();
  for (const entry of COMMAND_TABLE) {
    if (entry.keys.includes(text)) {
      await entry.handler(ctx);
      return true;
    }
  }
  return false;
}
