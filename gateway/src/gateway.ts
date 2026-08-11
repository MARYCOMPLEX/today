import { clientIdFromIdempotencyKey, openJson, randomClientId } from "./crypto";
import { classifyIlinkSendFailure, getUpdates, sendImageMessage, sendTextMessage } from "./ilink";
import { uploadImage, validateImage } from "./image";
import { errorMessage, logEvent } from "./log";
import { buildDigestChunks, queueRetryDecision, type QueuedNotification } from "./queue";
import { registerUser, type RegistrationInput } from "./registration";
import { isQuietHours } from "./time";
import type { BindingRow, Env, IlinkResponse, WeixinMessage } from "./types";

interface BindingWithSettings extends BindingRow { quiet_start_minutes: number; quiet_end_minutes: number }
interface SendInput { userId: string; text: string; idempotencyKey?: string; requestId: string }
interface ImageSendInput { userId: string; idempotencyKey?: string; requestId: string; bytes: Uint8Array }
interface PendingRow {
  id: string;
  text: string;
  created_at: number;
  kind: "text" | "image";
  image_key: string | null;
  attempt_count: number;
}

export type BindingUnavailableError = "wechat_not_bound" | "context_required" | "reauth_required";
type ReadyBinding = BindingRow & { status: "active"; context_token_ciphertext: string };
export type BindingReadiness =
  | { ready: true; binding: ReadyBinding }
  | { ready: false; error: BindingUnavailableError };

export function bindingReadiness(row: BindingRow | null): BindingReadiness {
  if (!row) return { ready: false, error: "wechat_not_bound" };
  if (row.status === "reauth_required") return { ready: false, error: "reauth_required" };
  if (row.status === "pending_context" || !row.context_token_ciphertext) return { ready: false, error: "context_required" };
  return { ready: true, binding: row as ReadyBinding };
}

const botAad = (row: BindingRow) => `wechat-bot/${row.user_id}/${row.generation}`;
const contextAad = (row: BindingRow) => `wechat-context/${row.user_id}/${row.generation}`;

export class Gateway {
  private tickRunning = false;
  private registrationTail: Promise<void> = Promise.resolve();

  constructor(private readonly ctx: DurableObjectState, private readonly env: Env) {}

  async fetch(request: Request): Promise<Response> {
    await this.ensureAlarm();
    const url = new URL(request.url);
    if (url.pathname === "/register" && request.method === "POST") {
      return this.serializedRegistration(await request.json<RegistrationInput>());
    }
    if (url.pathname === "/notify" && request.method === "POST") {
      return this.send(await request.json<SendInput>());
    }
    if (url.pathname === "/notify/image" && request.method === "POST") {
      const form = await request.formData();
      const image = form.get("image");
      if (!(image instanceof File)) return Response.json({ error: "missing_image" }, { status: 400 });
      return this.deliverImage({
        userId: String(form.get("userId") ?? ""),
        idempotencyKey: String(form.get("idempotencyKey") ?? "") || undefined,
        requestId: String(form.get("requestId") ?? "") || crypto.randomUUID(),
        bytes: new Uint8Array(await image.arrayBuffer()),
      });
    }
    if (url.pathname === "/tick" && request.method === "POST") {
      await this.tick();
      return Response.json({ ok: true });
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  async alarm(): Promise<void> {
    try { await this.tick(); } finally { await this.ctx.storage.setAlarm(Date.now() + 60_000); }
  }

  private async ensureAlarm(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + 1_000);
  }

  private serializedRegistration(input: RegistrationInput): Promise<Response> {
    let resolve!: (response: Response) => void;
    const result = new Promise<Response>((done) => { resolve = done; });
    this.registrationTail = this.registrationTail.then(async () => {
      try { resolve(await registerUser(this.env, input)); }
      catch (error) { resolve(Response.json({ error: errorMessage(error) }, { status: 500 })); }
    });
    return result;
  }

  private async send(input: SendInput): Promise<Response> {
    const readiness = bindingReadiness(await this.env.DB.prepare("SELECT * FROM wechat_binding WHERE user_id = ?").bind(input.userId).first<BindingRow>());
    if (!readiness.ready) return Response.json({ error: readiness.error }, { status: 503 });
    const row = readiness.binding;
    const [{ token }, { token: contextToken }] = await Promise.all([
      openJson<{ token: string }>(row.bot_token_ciphertext, this.env.MASTER_KEY, botAad(row)),
      openJson<{ token: string }>(row.context_token_ciphertext, this.env.MASTER_KEY, contextAad(row)),
    ]);
    const clientId = input.idempotencyKey
      ? await clientIdFromIdempotencyKey(`${input.userId}:${input.idempotencyKey}`)
      : randomClientId();
    const response = await sendTextMessage({ baseUrl: row.base_url, token, toUserId: row.owner_user_id, contextToken, clientId, text: input.text });
    const failure = await this.sendFailure(row, response, "ilink_rejected");
    if (failure) return failure;
    logEvent("notification_sent", { requestId: input.requestId, userId: input.userId, clientId });
    return Response.json({ ok: true, notification_id: clientId, sent_at: new Date().toISOString() });
  }

  private async deliverImage(input: ImageSendInput): Promise<Response> {
    try { validateImage(input.bytes); }
    catch (error) { return Response.json({ error: errorMessage(error) }, { status: errorMessage(error) === "unsupported_image_type" ? 415 : 400 }); }
    const readiness = bindingReadiness(await this.env.DB.prepare("SELECT * FROM wechat_binding WHERE user_id = ?").bind(input.userId).first<BindingRow>());
    if (!readiness.ready) return Response.json({ error: readiness.error }, { status: 503 });
    const row = readiness.binding;
    const [{ token }, { token: contextToken }] = await Promise.all([
      openJson<{ token: string }>(row.bot_token_ciphertext, this.env.MASTER_KEY, botAad(row)),
      openJson<{ token: string }>(row.context_token_ciphertext, this.env.MASTER_KEY, contextAad(row)),
    ]);
    const uploaded = await uploadImage({ baseUrl: row.base_url, token, toUserId: row.owner_user_id, bytes: input.bytes });
    const clientId = input.idempotencyKey
      ? await clientIdFromIdempotencyKey(`${input.userId}:${input.idempotencyKey}:image`)
      : randomClientId();
    const response = await sendImageMessage({
      baseUrl: row.base_url,
      token,
      toUserId: row.owner_user_id,
      contextToken,
      clientId,
      downloadParam: uploaded.downloadParam,
      aesKeyBase64: uploaded.aesKeyBase64,
      encryptedSize: uploaded.encryptedSize,
    });
    const failure = await this.sendFailure(row, response, "ilink_image_rejected");
    if (failure) return failure;
    logEvent("image_notification_sent", { requestId: input.requestId, userId: input.userId, clientId, bytes: input.bytes.length });
    return Response.json({ ok: true, notification_id: clientId, sent_at: new Date().toISOString() });
  }

  private async sendFailure(row: BindingRow, response: IlinkResponse, rejectedError: string): Promise<Response | null> {
    const failure = classifyIlinkSendFailure(response);
    if (!failure) return null;
    const code = response.errcode ?? response.ret ?? 0;
    if (failure === "rejected") {
      return Response.json({ error: rejectedError, code, message: response.errmsg ?? null }, { status: 502 });
    }
    const status = failure === "stale_token" ? "reauth_required" : "pending_context";
    await this.env.DB.prepare("UPDATE wechat_binding SET status = ?, last_error = ? WHERE user_id = ? AND generation = ?")
      .bind(status, failure, row.user_id, row.generation).run();
    logEvent("wechat_binding_status_changed", {
      userId: row.user_id,
      generation: row.generation,
      fromStatus: row.status,
      toStatus: status,
      reason: failure,
    });
    return Response.json({ error: failure === "stale_token" ? "reauth_required" : "context_required" }, { status: 503 });
  }

  private async tick(): Promise<void> {
    if (this.tickRunning) return;
    this.tickRunning = true;
    try {
      const result = await this.env.DB.prepare(`SELECT b.*, s.quiet_start_minutes, s.quiet_end_minutes
        FROM wechat_binding b JOIN notification_settings s ON s.user_id = b.user_id
        WHERE b.status != 'reauth_required'`).all<BindingWithSettings>();
      const rows: BindingWithSettings[] = result.results;
      for (let offset = 0; offset < rows.length; offset += 4) {
        await Promise.all(rows.slice(offset, offset + 4).map(async (row) => {
          try {
            await this.flush(row);
            await this.poll(row);
          } catch (error) {
            logEvent("gateway_tick_error", { userId: row.user_id, generation: row.generation, error: errorMessage(error) });
          }
        }));
      }
    } finally { this.tickRunning = false; }
  }

  private async poll(row: BindingWithSettings): Promise<void> {
    const { token } = await openJson<{ token: string }>(row.bot_token_ciphertext, this.env.MASTER_KEY, botAad(row));
    const response = await getUpdates(row.base_url, token, row.cursor);
    const code = response.errcode ?? response.ret ?? 0;
    const now = Date.now();
    if (code === -14) {
      await this.env.DB.prepare("UPDATE wechat_binding SET status = 'reauth_required', last_poll_at = ?, last_error = 'stale_token' WHERE user_id = ? AND generation = ?")
        .bind(now, row.user_id, row.generation).run();
      return;
    }
    if (code !== 0) throw new Error(`iLink getupdates ret=${code}`);
    const ownerMessage = [...(response.msgs ?? [])].reverse().find((message) => message.from_user_id === row.owner_user_id && message.context_token);
    if (ownerMessage?.context_token) {
      const { sealJson } = await import("./crypto");
      const ciphertext = await sealJson({ token: ownerMessage.context_token }, this.env.MASTER_KEY, contextAad(row));
      const wasActive = row.status === "active";
      await this.env.DB.prepare(`UPDATE wechat_binding SET cursor = ?, context_token_ciphertext = ?, status = 'active',
        context_updated_at = ?, last_poll_at = ?, last_error = NULL WHERE user_id = ? AND generation = ?`)
        .bind(response.get_updates_buf ?? row.cursor, ciphertext, now, now, row.user_id, row.generation).run();
      if (!wasActive || this.messageIsInit(ownerMessage)) {
        await this.sendActivationConfirmation(row, ownerMessage.context_token).catch((error) => {
          logEvent("activation_confirmation_failed", { userId: row.user_id, error: errorMessage(error) });
        });
      }
    } else {
      await this.env.DB.prepare("UPDATE wechat_binding SET cursor = ?, last_poll_at = ?, last_error = NULL WHERE user_id = ? AND generation = ?")
        .bind(response.get_updates_buf ?? row.cursor, now, row.user_id, row.generation).run();
    }
    logEvent("poll_ok", { userId: row.user_id, generation: row.generation, messageCount: response.msgs?.length ?? 0, contextUpdated: Boolean(ownerMessage) });
  }

  private messageIsInit(message: WeixinMessage): boolean {
    const text = message.item_list?.find((item) => item.type === 1)?.text_item?.text?.trim() ?? "";
    return text === "init" || text === "初始化" || text === "激活";
  }

  private async sendActivationConfirmation(row: BindingWithSettings, contextToken: string): Promise<void> {
    const { token } = await openJson<{ token: string }>(row.bot_token_ciphertext, this.env.MASTER_KEY, botAad(row));
    const clientId = randomClientId();
    const text = "✅ 微信通知网关已激活！\n绑定状态：active\n现在可以通过 API 推送通知到你的微信了。";
    await sendTextMessage({
      baseUrl: row.base_url,
      token,
      toUserId: row.owner_user_id,
      contextToken,
      clientId,
      text,
    });
    logEvent("activation_confirmation_sent", { userId: row.user_id });
  }

  private async flush(row: BindingWithSettings): Promise<void> {
    if (row.status !== "active" || !row.context_token_ciphertext || isQuietHours(new Date(), row.quiet_start_minutes, row.quiet_end_minutes)) return;
    const pending = await this.env.DB.prepare(`SELECT id, text, created_at, kind, image_key, attempt_count
      FROM notification_queue
      WHERE user_id = ? AND failed_at IS NULL AND next_attempt_at <= ?
      ORDER BY created_at, id`)
      .bind(row.user_id, Date.now()).all<PendingRow>();
    if (!pending.results.length) return;
    const items: PendingRow[] = pending.results;
    const textItems = items.filter((item) => item.kind === "text");
    if (textItems.length) {
      const chunks = buildDigestChunks(textItems.map((item): QueuedNotification => ({ id: item.id, text: item.text, createdAt: item.created_at })));
      try {
        for (let index = 0; index < chunks.length; index += 1) {
          const response = await this.send({ userId: row.user_id, text: chunks[index], idempotencyKey: `digest:${textItems.map((item) => item.id).join(":")}:${index}`, requestId: crypto.randomUUID() });
          if (!response.ok) {
            const failure = await this.responseFailure(response, "digest_send_failed");
            if (failure === "reauth_required") return;
            throw new Error(failure);
          }
        }
        await this.env.DB.batch(textItems.map((item) => this.env.DB.prepare("DELETE FROM notification_queue WHERE id = ? AND user_id = ?").bind(item.id, row.user_id)));
        logEvent("notification_digest_sent", { userId: row.user_id, queuedCount: textItems.length, chunkCount: chunks.length });
      } catch (error) {
        await this.defer(textItems, row.user_id, errorMessage(error));
      }
    }
    for (const item of items.filter((entry) => entry.kind === "image")) {
      if (!item.image_key) {
        await this.failPermanently(item, row.user_id, "missing_r2_key");
        continue;
      }
      const object = await this.env.IMAGES.get(item.image_key);
      if (!object) {
        await this.failPermanently(item, row.user_id, "missing_r2_object");
        continue;
      }
      try {
        const response = await this.deliverImage({
          userId: row.user_id,
          idempotencyKey: `queued-image:${item.id}`,
          requestId: crypto.randomUUID(),
          bytes: new Uint8Array(await object.arrayBuffer()),
        });
        if (!response.ok) {
          const body = await response.clone().json().catch(() => ({})) as { error?: string; code?: number };
          if (body.error === "reauth_required") return;
          if (response.status === 400 || response.status === 415 || (response.status === 502 && body.error === "ilink_image_rejected")) {
            await this.failPermanently(item, row.user_id, `${body.error ?? "invalid_image"}:${body.code ?? "unknown"}`);
            continue;
          }
          throw new Error(`${body.error ?? "queued_image_send_failed"}:${response.status}`);
        }
        await this.env.DB.prepare("DELETE FROM notification_queue WHERE id = ? AND user_id = ?").bind(item.id, row.user_id).run();
        await this.env.IMAGES.delete(item.image_key);
        logEvent("queued_image_sent", { userId: row.user_id, notificationId: item.id });
      } catch (error) {
        await this.defer([item], row.user_id, errorMessage(error));
      }
    }
  }

  private async responseFailure(response: Response, fallback: string): Promise<string> {
    const body = await response.clone().json().catch(() => ({})) as { error?: string; code?: number };
    return body.error === "reauth_required"
      ? "reauth_required"
      : `${body.error ?? fallback}:${body.code ?? response.status}`;
  }

  private async defer(items: PendingRow[], userId: string, failure: string): Promise<void> {
    const now = Date.now();
    const terminal: PendingRow[] = [];
    await this.env.DB.batch(items.map((item) => {
      const { attemptCount, nextAttemptAt, failedAt } = queueRetryDecision(now, item.attempt_count);
      if (failedAt !== null) terminal.push(item);
      return this.env.DB.prepare(`UPDATE notification_queue
        SET attempt_count = ?, next_attempt_at = ?, last_error = ?, failed_at = ?, image_key = CASE WHEN ? IS NULL THEN image_key ELSE NULL END
        WHERE id = ? AND user_id = ?`)
        .bind(attemptCount, nextAttemptAt, failure.slice(0, 500), failedAt, failedAt, item.id, userId);
    }));
    for (const item of terminal) {
      if (item.image_key) await this.env.IMAGES.delete(item.image_key);
    }
    logEvent(terminal.length ? "notification_delivery_failed" : "notification_delivery_deferred", {
      userId,
      notificationIds: items.map((item) => item.id),
      attempts: items.map((item) => item.attempt_count + 1),
      error: failure.slice(0, 500),
    });
  }

  private async failPermanently(item: PendingRow, userId: string, failure: string): Promise<void> {
    await this.env.DB.prepare(`UPDATE notification_queue
      SET attempt_count = attempt_count + 1, last_error = ?, failed_at = ?, image_key = NULL
      WHERE id = ? AND user_id = ?`)
      .bind(failure.slice(0, 500), Date.now(), item.id, userId).run();
    if (item.image_key) await this.env.IMAGES.delete(item.image_key);
    logEvent("notification_delivery_failed", {
      userId,
      notificationIds: [item.id],
      attempts: [item.attempt_count + 1],
      error: failure.slice(0, 500),
    });
  }
}
