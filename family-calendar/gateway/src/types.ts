export interface Env {
  DB: D1Database;
  GATEWAY: DurableObjectNamespace;
  IMAGES: R2Bucket;
  BETTER_AUTH_SECRET: string;
  MASTER_KEY: string;
}

export type AccountStatus = "active" | "reauth_required";

export interface AccountState {
  generation: string;
  token: string;
  baseUrl: string;
  botId: string;
  ownerUserId: string;
  savedAt: string;
  status: AccountStatus;
}

export interface SyncState {
  cursor: string;
  lastPollAt: string | null;
  lastError: string | null;
}

export interface ContextState {
  token: string;
  updatedAt: string;
}

export interface LoginSession {
  userId: string;
  qrcode: string;
  baseUrl: string;
  expiresAt: number;
}

export interface SessionUser { id: string; email: string; name: string }

export interface BindingRow {
  user_id: string;
  generation: string;
  bot_token_ciphertext: string;
  context_token_ciphertext: string | null;
  base_url: string;
  bot_id: string;
  owner_user_id: string;
  cursor: string;
  status: "pending_context" | "active" | "reauth_required";
  bound_at: number;
  context_updated_at: number | null;
  last_poll_at: number | null;
  last_error: string | null;
}

export type LoginStatusName =
  | "wait"
  | "scaned"
  | "confirmed"
  | "expired"
  | "scaned_but_redirect"
  | "need_verifycode"
  | "verify_code_blocked"
  | "binded_redirect";

export interface LoginStatusResponse {
  status: LoginStatusName;
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
  redirect_host?: string;
}

export interface WeixinMessage {
  message_id?: number;
  from_user_id?: string;
  context_token?: string;
  message_type?: number;
}

export interface GetUpdatesResponse {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

export interface IlinkResponse {
  ret?: number;
  errcode?: number;
  errmsg?: string;
}

export interface GetUploadUrlResponse extends IlinkResponse {
  upload_param?: string;
  upload_full_url?: string;
}
