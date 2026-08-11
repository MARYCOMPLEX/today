import { Hono } from "hono";
import { renderSVG } from "uqr";
import { authenticateApiKey, createOrRotateApiKey, revealApiKey } from "./api-key";
import { createAuth } from "./auth";
import { openJson, randomToken, sealJson } from "./crypto";
import { gatewayStub, sessionUser, userRole } from "./db";
import { Gateway } from "./gateway";
import { MAX_IMAGE_BYTES, MAX_IMAGE_REQUEST_BYTES, validateImage } from "./image";
import { DEFAULT_BASE_URL, notifyStart, notifyStop, pollLogin, startLogin } from "./ilink";
import { errorMessage, logEvent } from "./log";
import { apiMarkdown, dashboardPage, loginPage, registerPage } from "./pages";
import { passwordProblem, validChinaPhone } from "./password";
import { createInvitation } from "./registration";
import { addEventFormPage, addEventResultPage } from "./pages";
import { addEventFromForm, claimAddToken, validateEventInput } from "./add-event";
import { isQuietHours, nextQuietEnd, timeToMinutes } from "./time";
import type { BindingRow, Env, LoginSession, SessionUser } from "./types";

type Variables = { requestId: string; user: SessionUser };
const app = new Hono<{ Bindings: Env; Variables: Variables }>();
const MAX_BODY_BYTES = 20_000;
const gatewayUrl = (path: string) => `https://gateway.internal${path}`;
const originOf = (url: string) => new URL(url).origin;
const loginAad = (userId: string) => `login/session/${userId}`;
const botAad = (userId: string, generation: string) => `wechat-bot/${userId}/${generation}`;

app.use("*", async (c, next) => {
  const requestId = c.req.header("X-Request-Id") || crypto.randomUUID();
  c.set("requestId", requestId);
  c.header("X-Request-Id", requestId);
  await next();
});

async function requireSession(c: any, next: () => Promise<void>) {
  const user = await sessionUser(c.env, originOf(c.req.url), c.req.raw.headers);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  c.set("user", user);
  await next();
}

app.get("/health", async (c) => {
  const d1 = await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
  return c.json({ ok: d1?.ok === 1, service: "wx-clawbot-notify-webhook" });
});
app.get("/", (c) => c.redirect("/dashboard"));
app.get("/docs", (c) => {
  c.header("Content-Type", "text/markdown; charset=UTF-8");
  return c.body(apiMarkdown(originOf(c.req.url)));
});
app.get("/login", (c) => c.html(loginPage()));
app.get("/register", (c) => c.html(registerPage(c.req.query("invite") ?? "")));

app.post("/api/register", async (c) => {
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return c.json({ error: "invalid_json" }, 400);
  const response = await gatewayStub(c.env).fetch(gatewayUrl("/register"), {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Request-Id": c.get("requestId") },
    body: JSON.stringify({
      email: String(body.email ?? ""), password: String(body.password ?? ""),
      phone: body.phone ? String(body.phone) : undefined, invitationCode: String(body.invitationCode ?? ""),
      origin: originOf(c.req.url),
    }),
  });
  return response;
});

app.all("/api/auth/sign-up/email", (c) => c.json({ error: "invite_required" }, 404));
app.all("/api/auth/change-password", (c) => c.json({ error: "use_/api/password" }, 404));
app.all("/api/auth/*", (c) => createAuth(c.env, originOf(c.req.url)).handler(c.req.raw));

app.get("/add-event", async (c) => {
  const token = c.req.query("token") ?? "";
  const claim = await claimAddToken(c.env, token, false);
  if (!claim.ok) return c.html(addEventResultPage({ ok: false, message: claim.error }));
  return c.html(addEventFormPage({ token }));
});

app.post("/api/add-event", async (c) => {
  const body = await c.req.parseBody().catch(() => ({})) as Record<string, unknown>;
  const token = String(body.token ?? "");
  const claim = await claimAddToken(c.env, token, true);
  if (!claim.ok) return c.html(addEventResultPage({ ok: false, message: claim.error }));
  const validated = validateEventInput(body);
  if (!validated.ok) {
    return c.html(addEventFormPage({
      token,
      error: validated.error,
      values: {
        name: String(body.name ?? ""), person: String(body.person ?? ""),
        calendar: String(body.calendar ?? "lunar"), month: String(body.month ?? ""), day: String(body.day ?? ""),
        leap_policy: String(body.leap_policy ?? "leap_first"), leap_day_policy: String(body.leap_day_policy ?? "feb28"),
        birth_year: String(body.birth_year ?? ""), message: String(body.message ?? ""),
      },
    }));
  }
  try {
    await addEventFromForm(c.env, validated.value);
  } catch (error) {
    const message = errorMessage(error);
    logEvent("add_event_write_failed", { requestId: c.get("requestId"), userId: claim.userId, error: message });
    return c.html(addEventResultPage({ ok: false, message: `写入失败：${message}。请稍后重试或联系管理员。` }));
  }
  logEvent("add_event_created", { requestId: c.get("requestId"), userId: claim.userId, name: validated.value.name });
  const confirmText = `✅ 已添加：${validated.value.name}（${validated.value.person}，${validated.value.calendar === "lunar" ? "农历" : "阳历"} ${validated.value.month}月${validated.value.day}日）。将在每天三个时段播报。`;
  gatewayStub(c.env).fetch(gatewayUrl("/notify"), {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Request-Id": c.get("requestId") },
    body: JSON.stringify({ userId: claim.userId, idempotencyKey: `add-event:${token}`, requestId: c.get("requestId"), text: confirmText }),
  }).catch(() => {});
  return c.html(addEventResultPage({ ok: true, message: confirmText, link: "https://github.com/MARYCOMPLEX/today/blob/main/data/events.json" }));
});

app.get("/dashboard", async (c) => {
  const user = await sessionUser(c.env, originOf(c.req.url), c.req.raw.headers);
  if (!user) return c.redirect("/login");
  const [profile, settings, binding] = await Promise.all([
    c.env.DB.prepare("SELECT phone, role FROM user_profile WHERE user_id = ?").bind(user.id).first<{ phone: string | null; role: "user" | "admin" }>(),
    c.env.DB.prepare("SELECT quiet_start_minutes, quiet_end_minutes FROM notification_settings WHERE user_id = ?").bind(user.id).first<{ quiet_start_minutes: number; quiet_end_minutes: number }>(),
    c.env.DB.prepare("SELECT status FROM wechat_binding WHERE user_id = ?").bind(user.id).first<Pick<BindingRow, "status">>(),
  ]);
  return c.html(dashboardPage({
    email: user.email, role: profile?.role ?? "user", phone: profile?.phone ?? null,
    quietStart: settings?.quiet_start_minutes ?? 0, quietEnd: settings?.quiet_end_minutes ?? 420,
    bindingStatus: binding?.status ?? null, origin: originOf(c.req.url),
  }));
});

app.use("/api/api-key", requireSession);
app.get("/api/api-key", async (c) => c.json({ api_key: await revealApiKey(c.env, c.get("user").id) }));
app.post("/api/api-key", async (c) => {
  const token = await createOrRotateApiKey(c.env, c.get("user").id);
  logEvent("api_key_rotated", { requestId: c.get("requestId"), userId: c.get("user").id });
  return c.json({ api_key: token });
});

app.put("/api/settings", requireSession, async (c) => {
  const body = await c.req.json<{ quietStart?: string; quietEnd?: string; phone?: string }>();
  const start = timeToMinutes(body.quietStart ?? "");
  const end = timeToMinutes(body.quietEnd ?? "");
  const phone = body.phone?.trim() || null;
  if (start === null || end === null) return c.json({ error: "invalid_quiet_time" }, 400);
  if (phone && !validChinaPhone(phone)) return c.json({ error: "手机号必须是中国大陆 11 位手机号" }, 400);
  const userId = c.get("user").id;
  try {
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE notification_settings SET quiet_start_minutes = ?, quiet_end_minutes = ?, updated_at = ? WHERE user_id = ?").bind(start, end, Date.now(), userId),
      c.env.DB.prepare("UPDATE user_profile SET phone = ?, updated_at = ? WHERE user_id = ?").bind(phone, Date.now(), userId),
    ]);
  } catch (error) {
    if (errorMessage(error).includes("UNIQUE")) return c.json({ error: "该手机号已被使用" }, 409);
    throw error;
  }
  return c.json({ ok: true });
});

app.post("/api/password", requireSession, async (c) => {
  const body = await c.req.json<{ currentPassword?: string; newPassword?: string }>();
  const phone = await c.env.DB.prepare("SELECT phone FROM user_profile WHERE user_id = ?").bind(c.get("user").id).first<{ phone: string | null }>();
  const problem = passwordProblem(body.newPassword ?? "", c.get("user").email, phone?.phone);
  if (problem) return c.json({ error: problem }, 400);
  const headers = new Headers(c.req.raw.headers);
  headers.set("Content-Type", "application/json");
  const request = new Request(`${originOf(c.req.url)}/api/auth/change-password`, {
    method: "POST", headers,
    body: JSON.stringify({ currentPassword: body.currentPassword ?? "", newPassword: body.newPassword, revokeOtherSessions: true }),
  });
  return createAuth(c.env, originOf(c.req.url)).handler(request);
});

app.get("/api/wechat/status", requireSession, async (c) => {
  const row = await c.env.DB.prepare("SELECT status, bound_at, context_updated_at, last_poll_at, last_error FROM wechat_binding WHERE user_id = ?")
    .bind(c.get("user").id).first<Record<string, unknown>>();
  return c.json({ configured: Boolean(row), ready: row?.status === "active", ...row });
});

app.post("/api/wechat/login/start", requireSession, async (c) => {
  const userId = c.get("user").id;
  const current = await c.env.DB.prepare("SELECT * FROM wechat_binding WHERE user_id = ?").bind(userId).first<BindingRow>();
  let localTokens: string[] = [];
  if (current) {
    const decrypted = await openJson<{ token: string }>(current.bot_token_ciphertext, c.env.MASTER_KEY, botAad(userId, current.generation));
    localTokens = [decrypted.token];
  }
  const qr = await startLogin(localTokens);
  const session: LoginSession = { userId, qrcode: qr.qrcode, baseUrl: DEFAULT_BASE_URL, expiresAt: Date.now() + 5 * 60_000 };
  return c.json({
    session: await sealJson(session, c.env.MASTER_KEY, loginAad(userId)),
    qr_svg: renderSVG(qr.qrcode_img_content, { ecc: "M", border: 3 }),
  });
});

app.post("/api/wechat/login/status", requireSession, async (c) => {
  const userId = c.get("user").id;
  const body = await c.req.json<{ session?: string; verifyCode?: string }>();
  if (!body.session) return c.json({ error: "missing_session" }, 400);
  const session = await openJson<LoginSession>(body.session, c.env.MASTER_KEY, loginAad(userId));
  if (session.userId !== userId) return c.json({ error: "invalid_session_owner" }, 403);
  if (session.expiresAt <= Date.now()) return c.json({ status: "expired", message: "二维码已过期" });
  const result = await pollLogin(session.baseUrl, session.qrcode, body.verifyCode?.trim());
  if (result.status === "scaned_but_redirect" && result.redirect_host) session.baseUrl = `https://${result.redirect_host}`;
  const sealedSession = await sealJson(session, c.env.MASTER_KEY, loginAad(userId));
  if (result.status !== "confirmed") return c.json({ status: result.status, session: sealedSession });
  if (!result.bot_token || !result.ilink_bot_id || !result.ilink_user_id) return c.json({ error: "incomplete_login_response" }, 502);

  const current = await c.env.DB.prepare("SELECT * FROM wechat_binding WHERE user_id = ?").bind(userId).first<BindingRow>();
  if (current) {
    try {
      const old = await openJson<{ token: string }>(current.bot_token_ciphertext, c.env.MASTER_KEY, botAad(userId, current.generation));
      await notifyStop(current.base_url, old.token);
    } catch (error) { logEvent("notify_stop_error", { userId, error: errorMessage(error) }); }
  }
  const generation = crypto.randomUUID();
  const baseUrl = result.baseurl || session.baseUrl || DEFAULT_BASE_URL;
  const ciphertext = await sealJson({ token: result.bot_token }, c.env.MASTER_KEY, botAad(userId, generation));
  await c.env.DB.prepare(`INSERT INTO wechat_binding
    (user_id, generation, bot_token_ciphertext, context_token_ciphertext, base_url, bot_id, owner_user_id, cursor, status, bound_at)
    VALUES (?, ?, ?, NULL, ?, ?, ?, '', 'pending_context', ?)
    ON CONFLICT(user_id) DO UPDATE SET generation=excluded.generation, bot_token_ciphertext=excluded.bot_token_ciphertext,
    context_token_ciphertext=NULL, base_url=excluded.base_url, bot_id=excluded.bot_id, owner_user_id=excluded.owner_user_id,
    cursor='', status='pending_context', bound_at=excluded.bound_at, context_updated_at=NULL, last_poll_at=NULL, last_error=NULL`)
    .bind(userId, generation, ciphertext, baseUrl, result.ilink_bot_id, result.ilink_user_id, Date.now()).run();
  try { await notifyStart(baseUrl, result.bot_token); }
  catch (error) { logEvent("notify_start_error", { userId, generation, error: errorMessage(error) }); }
  logEvent("wechat_bound", { requestId: c.get("requestId"), userId, generation });
  c.executionCtx.waitUntil(gatewayStub(c.env).fetch(gatewayUrl("/tick"), { method: "POST" }).then(() => undefined));
  return c.json({ status: "confirmed" });
});

app.post("/api/admin/invitations", requireSession, async (c) => {
  const user = c.get("user");
  if (await userRole(c.env, user.id) !== "admin") return c.json({ error: "forbidden" }, 403);
  const body: { email?: string | null } = await c.req.json<{ email?: string | null }>().catch(() => ({}));
  const email = body.email?.trim().toLowerCase() || null;
  if (email && !/^\S+@\S+\.\S+$/.test(email)) return c.json({ error: "invalid_email" }, 400);
  const token = randomToken("wxi_");
  const id = crypto.randomUUID();
  await createInvitation(c.env, user.id, email, "user", Date.now() + 7 * 24 * 60 * 60_000, token, id);
  return c.json({ url: `${originOf(c.req.url)}/register?invite=${encodeURIComponent(token)}`, expires_in_days: 7 });
});

app.post("/api/v1/notify", async (c) => {
  const userId = await authenticateApiKey(c.env, c.req.header("Authorization"));
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const declaredLength = Number(c.req.header("Content-Length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) return c.json({ error: "payload_too_large" }, 413);
  const raw = await c.req.text();
  if (raw.length > MAX_BODY_BYTES) return c.json({ error: "payload_too_large" }, 413);
  let body: { text?: unknown; urgent?: unknown };
  try { body = JSON.parse(raw); } catch { return c.json({ error: "invalid_json" }, 400); }
  const urgent = body.urgent ?? false;
  if (typeof body.text !== "string" || body.text.length < 1 || body.text.length > 4000) return c.json({ error: "text_must_be_1_to_4000_characters" }, 400);
  if (typeof urgent !== "boolean") return c.json({ error: "urgent_must_be_boolean" }, 400);
  const idempotencyKey = c.req.header("Idempotency-Key")?.trim() || null;
  if (idempotencyKey && idempotencyKey.length > 128) return c.json({ error: "idempotency_key_max_128" }, 400);
  const settings = await c.env.DB.prepare("SELECT quiet_start_minutes, quiet_end_minutes FROM notification_settings WHERE user_id = ?")
    .bind(userId).first<{ quiet_start_minutes: number; quiet_end_minutes: number }>();
  const start = settings?.quiet_start_minutes ?? 0, end = settings?.quiet_end_minutes ?? 420;
  if (!urgent && isQuietHours(new Date(), start, end)) {
    const id = crypto.randomUUID(), now = Date.now();
    const result = await c.env.DB.prepare(`INSERT INTO notification_queue (id, user_id, text, idempotency_key, created_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, idempotency_key) DO NOTHING`)
      .bind(id, userId, body.text, idempotencyKey, now).run();
    const actual = result.meta.changes === 0 && idempotencyKey
      ? await c.env.DB.prepare("SELECT id, failed_at FROM notification_queue WHERE user_id = ? AND idempotency_key = ?").bind(userId, idempotencyKey).first<{ id: string; failed_at: number | null }>()
      : { id, failed_at: null };
    if (actual?.failed_at) return c.json({ error: "notification_delivery_failed", notification_id: actual.id }, 409);
    logEvent("notification_queued", { requestId: c.get("requestId"), userId, notificationId: actual?.id });
    return c.json({ ok: true, status: "queued", notification_id: actual?.id, scheduled_for: nextQuietEnd(new Date(), start, end) }, 202);
  }
  return gatewayStub(c.env).fetch(gatewayUrl("/notify"), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, text: body.text, idempotencyKey: idempotencyKey ?? undefined, requestId: c.get("requestId") }),
  });
});

app.post("/api/v1/notify/image", async (c) => {
  const userId = await authenticateApiKey(c.env, c.req.header("Authorization"));
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const declaredLength = Number(c.req.header("Content-Length") ?? "0");
  if (declaredLength > MAX_IMAGE_REQUEST_BYTES) return c.json({ error: "image_max_20_mib" }, 413);
  if (!c.req.header("Content-Type")?.toLowerCase().startsWith("multipart/form-data")) {
    return c.json({ error: "multipart_form_data_required" }, 415);
  }
  const form = await c.req.formData();
  const image = form.get("image");
  if (!(image instanceof File)) return c.json({ error: "missing_image" }, 400);
  if (image.size > MAX_IMAGE_BYTES) return c.json({ error: "image_max_20_mib" }, 413);
  if (form.has("text")) return c.json({ error: "image_caption_not_supported" }, 400);
  const urgentValue = form.get("urgent");
  if (urgentValue !== null && urgentValue !== "true" && urgentValue !== "false") {
    return c.json({ error: "urgent_must_be_true_or_false" }, 400);
  }
  const urgent = urgentValue === "true";
  const idempotencyKey = c.req.header("Idempotency-Key")?.trim() || null;
  if (idempotencyKey && idempotencyKey.length > 128) return c.json({ error: "idempotency_key_max_128" }, 400);
  const bytes = new Uint8Array(await image.arrayBuffer());
  let imageType;
  try { imageType = validateImage(bytes); }
  catch (error) {
    const message = errorMessage(error);
    if (message === "image_max_20_mib") return c.json({ error: message }, 413);
    if (message === "unsupported_image_type") return c.json({ error: message, supported: ["image/jpeg", "image/png", "image/webp"] }, 415);
    return c.json({ error: message }, 400);
  }
  const settings = await c.env.DB.prepare("SELECT quiet_start_minutes, quiet_end_minutes FROM notification_settings WHERE user_id = ?")
    .bind(userId).first<{ quiet_start_minutes: number; quiet_end_minutes: number }>();
  const start = settings?.quiet_start_minutes ?? 0, end = settings?.quiet_end_minutes ?? 420;
  if (!urgent && isQuietHours(new Date(), start, end)) {
    if (idempotencyKey) {
      const existing = await c.env.DB.prepare("SELECT id, failed_at FROM notification_queue WHERE user_id = ? AND idempotency_key = ?")
        .bind(userId, idempotencyKey).first<{ id: string; failed_at: number | null }>();
      if (existing?.failed_at) return c.json({ error: "notification_delivery_failed", notification_id: existing.id }, 409);
      if (existing) return c.json({ ok: true, status: "queued", notification_id: existing.id, scheduled_for: nextQuietEnd(new Date(), start, end) }, 202);
    }
    const id = crypto.randomUUID();
    const imageKey = `pending/${userId}/${id}.${imageType.extension}`;
    await c.env.IMAGES.put(imageKey, bytes, { httpMetadata: { contentType: imageType.mime } });
    try {
      const result = await c.env.DB.prepare(`INSERT INTO notification_queue
        (id, user_id, text, idempotency_key, created_at, kind, image_key)
        VALUES (?, ?, ?, ?, ?, 'image', ?) ON CONFLICT(user_id, idempotency_key) DO NOTHING`)
        .bind(id, userId, "", idempotencyKey, Date.now(), imageKey).run();
      if (result.meta.changes === 0 && idempotencyKey) {
        await c.env.IMAGES.delete(imageKey);
        const existing = await c.env.DB.prepare("SELECT id FROM notification_queue WHERE user_id = ? AND idempotency_key = ?")
          .bind(userId, idempotencyKey).first<{ id: string }>();
        return c.json({ ok: true, status: "queued", notification_id: existing?.id, scheduled_for: nextQuietEnd(new Date(), start, end) }, 202);
      }
    } catch (error) {
      await c.env.IMAGES.delete(imageKey);
      throw error;
    }
    logEvent("image_notification_queued", { requestId: c.get("requestId"), userId, notificationId: id, bytes: bytes.length });
    return c.json({ ok: true, status: "queued", notification_id: id, scheduled_for: nextQuietEnd(new Date(), start, end) }, 202);
  }
  const internal = new FormData();
  internal.set("userId", userId);
  internal.set("idempotencyKey", idempotencyKey ?? "");
  internal.set("requestId", c.get("requestId"));
  internal.set("image", new Blob([bytes], { type: imageType.mime }), `image.${imageType.extension}`);
  return gatewayStub(c.env).fetch(gatewayUrl("/notify/image"), { method: "POST", body: internal });
});

app.notFound((c) => c.json({ error: "not_found" }, 404));
app.onError((error, c) => {
  logEvent("request_error", { requestId: c.get("requestId"), path: c.req.path, error: errorMessage(error) });
  return c.json({ error: "internal_error", message: errorMessage(error) }, 500);
});

export { Gateway };
export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(gatewayStub(env).fetch(gatewayUrl("/tick"), { method: "POST" }).then(() => undefined));
  },
};
