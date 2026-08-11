import type {
  GetUpdatesResponse,
  GetUploadUrlResponse,
  IlinkResponse,
  LoginStatusResponse,
} from "./types";

export const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
export type IlinkSendFailure = "stale_token" | "stale_context" | "rejected";
const CHANNEL_VERSION = "2.4.6";
const ILINK_APP_ID = "bot";
const BOT_AGENT = "WxNotifyGateway/0.1.0";
const ILINK_CLIENT_VERSION = (2 << 16) | (4 << 8) | 6;
const SEND_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 250;

class PermanentIlinkHttpError extends Error {}

function baseInfo() {
  return { channel_version: CHANNEL_VERSION, bot_agent: BOT_AGENT };
}

export function classifyIlinkSendFailure(response: IlinkResponse): IlinkSendFailure | null {
  const code = response.errcode ?? response.ret ?? 0;
  if (code === 0) return null;
  if (code === -14) return "stale_token";
  if (code === -2 && response.errmsg === "prepare failed") return "stale_context";
  return "rejected";
}

function randomWechatUin(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const value = new DataView(bytes.buffer).getUint32(0, false);
  return btoa(String(value));
}

function commonHeaders(): Record<string, string> {
  return {
    "iLink-App-Id": ILINK_APP_ID,
    "iLink-App-ClientVersion": String(ILINK_CLIENT_VERSION),
  };
}

function postHeaders(token?: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": randomWechatUin(),
    ...commonHeaders(),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function requestText(
  url: URL,
  init: RequestInit,
  timeoutMs: number,
  maxAttempts = 1,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const text = await response.text();
      if (response.ok) return text;
      const error = new Error(`iLink HTTP ${response.status}`);
      if (response.status !== 429 && response.status < 500) {
        throw new PermanentIlinkHttpError(error.message);
      }
      lastError = error;
    } catch (error) {
      if (error instanceof PermanentIlinkHttpError) throw error;
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_DELAY_MS * (2 ** (attempt - 1))));
    }
  }
  throw new Error(`iLink request failed after ${maxAttempts} attempts`, { cause: lastError });
}

async function postJson<T>(
  baseUrl: string,
  endpoint: string,
  body: unknown,
  options: { token?: string; timeoutMs?: number; maxAttempts?: number } = {},
): Promise<T> {
  const url = new URL(endpoint, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const text = await requestText(
    url,
    { method: "POST", headers: postHeaders(options.token), body: JSON.stringify(body) },
    options.timeoutMs ?? 15_000,
    options.maxAttempts ?? 1,
  );
  return JSON.parse(text) as T;
}

export async function startLogin(localTokenList: string[]): Promise<{
  qrcode: string;
  qrcode_img_content: string;
}> {
  return postJson(
    DEFAULT_BASE_URL,
    "ilink/bot/get_bot_qrcode?bot_type=3",
    { local_token_list: localTokenList.slice(0, 10) },
    { timeoutMs: 40_000 },
  );
}

export async function pollLogin(
  baseUrl: string,
  qrcode: string,
  verifyCode?: string,
): Promise<LoginStatusResponse> {
  const url = new URL("ilink/bot/get_qrcode_status", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  url.searchParams.set("qrcode", qrcode);
  if (verifyCode) url.searchParams.set("verify_code", verifyCode);
  try {
    const text = await requestText(url, { method: "GET", headers: commonHeaders() }, 40_000);
    return JSON.parse(text) as LoginStatusResponse;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return { status: "wait" };
    throw error;
  }
}

export async function getUpdates(
  baseUrl: string,
  token: string,
  cursor: string,
): Promise<GetUpdatesResponse> {
  try {
    return await postJson<GetUpdatesResponse>(
      baseUrl,
      "ilink/bot/getupdates",
      { get_updates_buf: cursor, base_info: baseInfo() },
      { token, timeoutMs: 40_000 },
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ret: 0, msgs: [], get_updates_buf: cursor };
    }
    throw error;
  }
}

export async function sendTextMessage(params: {
  baseUrl: string;
  token: string;
  toUserId: string;
  contextToken: string;
  clientId: string;
  text: string;
}): Promise<IlinkResponse> {
  return postJson<IlinkResponse>(
    params.baseUrl,
    "ilink/bot/sendmessage",
    {
      msg: {
        from_user_id: "",
        to_user_id: params.toUserId,
        client_id: params.clientId,
        message_type: 2,
        message_state: 2,
        context_token: params.contextToken,
        item_list: [{ type: 1, text_item: { text: params.text } }],
      },
      base_info: baseInfo(),
    },
    { token: params.token, timeoutMs: 15_000, maxAttempts: SEND_ATTEMPTS },
  );
}

export async function getImageUploadUrl(params: {
  baseUrl: string;
  token: string;
  toUserId: string;
  fileKey: string;
  rawSize: number;
  rawMd5: string;
  encryptedSize: number;
  aesKeyHex: string;
}): Promise<GetUploadUrlResponse> {
  return postJson<GetUploadUrlResponse>(
    params.baseUrl,
    "ilink/bot/getuploadurl",
    {
      filekey: params.fileKey,
      media_type: 1,
      to_user_id: params.toUserId,
      rawsize: params.rawSize,
      rawfilemd5: params.rawMd5,
      filesize: params.encryptedSize,
      no_need_thumb: true,
      aeskey: params.aesKeyHex,
      base_info: baseInfo(),
    },
    { token: params.token, timeoutMs: 15_000, maxAttempts: SEND_ATTEMPTS },
  );
}

export async function sendImageMessage(params: {
  baseUrl: string;
  token: string;
  toUserId: string;
  contextToken: string;
  clientId: string;
  downloadParam: string;
  aesKeyBase64: string;
  encryptedSize: number;
}): Promise<IlinkResponse> {
  return postJson<IlinkResponse>(
    params.baseUrl,
    "ilink/bot/sendmessage",
    {
      msg: {
        from_user_id: "",
        to_user_id: params.toUserId,
        client_id: params.clientId,
        message_type: 2,
        message_state: 2,
        context_token: params.contextToken,
        item_list: [{
          type: 2,
          image_item: {
            media: {
              encrypt_query_param: params.downloadParam,
              aes_key: params.aesKeyBase64,
              encrypt_type: 1,
            },
            mid_size: params.encryptedSize,
          },
        }],
      },
      base_info: baseInfo(),
    },
    { token: params.token, timeoutMs: 15_000, maxAttempts: SEND_ATTEMPTS },
  );
}

export async function notifyStart(baseUrl: string, token: string): Promise<IlinkResponse> {
  return postJson<IlinkResponse>(
    baseUrl,
    "ilink/bot/msg/notifystart",
    { base_info: baseInfo() },
    { token, timeoutMs: 10_000 },
  );
}

export async function notifyStop(baseUrl: string, token: string): Promise<IlinkResponse> {
  return postJson<IlinkResponse>(
    baseUrl,
    "ilink/bot/msg/notifystop",
    { base_info: baseInfo() },
    { token, timeoutMs: 10_000 },
  );
}
