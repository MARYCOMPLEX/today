// GitHub Contents API 写回 data/events.json（添加日期功能）
import type { Env } from "./types";

async function gh<T>(env: Env, method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "User-Agent": "wx-clawbot-notify-webhook",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`GitHub ${method} ${path} -> ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json() as Promise<T>;
}

interface GhContent { sha: string; content: string }

const eventsCache = new Map<string, { at: number; data: unknown }>();
const EVENTS_CACHE_TTL_MS = 60_000;

export async function fetchEvents(env: Env): Promise<{ events: Record<string, unknown>[] }> {
  const repo = env.GITHUB_REPO ?? "MARYCOMPLEX/today";
  const cached = eventsCache.get(repo);
  if (cached && Date.now() - cached.at < EVENTS_CACHE_TTL_MS) return cached.data as { events: Record<string, unknown>[] };
  const r = await fetch(`https://raw.githubusercontent.com/${repo}/main/data/events.json`, {
    headers: env.GITHUB_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` } : {},
  });
  if (!r.ok) throw new Error(`fetch events.json -> ${r.status}`);
  const data = await r.json() as { events: Record<string, unknown>[] };
  eventsCache.set(repo, { at: Date.now(), data });
  return data;
}

export async function appendEvent(env: Env, event: Record<string, unknown>): Promise<void> {
  const data = await gh<GhContent>(env, "GET", "/contents/data/events.json");
  const full = JSON.parse(Buffer.from(data.content, "base64").toString("utf-8"));
  const events: Record<string, unknown>[] = full.events ?? [];
  const idx = events.findIndex((e) => e.id === event.id);
  if (idx >= 0) events[idx] = event;
  else events.push(event);
  full.events = events;
  await gh(env, "PUT", "/contents/data/events.json", {
    message: `feat: add event ${String(event.id)} from wechat form`,
    content: Buffer.from(JSON.stringify(full, null, 2) + "\n").toString("base64"),
    sha: data.sha,
  });
}

export async function removeEventsByIds(env: Env, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const data = await gh<GhContent>(env, "GET", "/contents/data/events.json");
  const full = JSON.parse(Buffer.from(data.content, "base64").toString("utf-8"));
  const events: Record<string, unknown>[] = full.events ?? [];
  const before = events.length;
  const idSet = new Set(ids);
  const kept = events.filter((e) => !idSet.has(String(e.id)));
  const removed = before - kept.length;
  if (removed === 0) return 0;
  full.events = kept;
  await gh(env, "PUT", "/contents/data/events.json", {
    message: `chore: remove ${removed} event(s) from wechat form`,
    content: Buffer.from(JSON.stringify(full, null, 2) + "\n").toString("base64"),
    sha: data.sha,
  });
  eventsCache.delete(env.GITHUB_REPO ?? "MARYCOMPLEX/today");
  return removed;
}
