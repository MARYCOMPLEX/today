PRAGMA foreign_keys = ON;

CREATE TABLE user (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE session (
  id TEXT PRIMARY KEY NOT NULL,
  expires_at INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
);
CREATE INDEX session_user_id_idx ON session(user_id);

CREATE TABLE account (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at INTEGER,
  refresh_token_expires_at INTEGER,
  scope TEXT,
  password TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX account_user_id_idx ON account(user_id);

CREATE TABLE verification (
  id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER,
  updated_at INTEGER
);
CREATE INDEX verification_identifier_idx ON verification(identifier);

CREATE TABLE invitation (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  expires_at INTEGER NOT NULL,
  created_by TEXT REFERENCES user(id),
  created_at INTEGER NOT NULL,
  consumed_at INTEGER,
  consumed_by TEXT REFERENCES user(id)
);
CREATE INDEX invitation_available_idx ON invitation(token_hash, consumed_at, expires_at);

CREATE TABLE user_profile (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  phone TEXT UNIQUE,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE notification_settings (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  quiet_start_minutes INTEGER NOT NULL DEFAULT 0 CHECK (quiet_start_minutes BETWEEN 0 AND 1439),
  quiet_end_minutes INTEGER NOT NULL DEFAULT 420 CHECK (quiet_end_minutes BETWEEN 0 AND 1439),
  updated_at INTEGER NOT NULL
);

CREATE TABLE api_key (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  token_ciphertext TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  rotated_at INTEGER
);

CREATE TABLE wechat_binding (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  generation TEXT NOT NULL,
  bot_token_ciphertext TEXT NOT NULL,
  context_token_ciphertext TEXT,
  base_url TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  cursor TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('pending_context', 'active', 'reauth_required')),
  bound_at INTEGER NOT NULL,
  context_updated_at INTEGER,
  last_poll_at INTEGER,
  last_error TEXT
);
CREATE INDEX wechat_binding_status_idx ON wechat_binding(status);

CREATE TABLE notification_queue (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  idempotency_key TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, idempotency_key)
);
CREATE INDEX notification_queue_user_created_idx ON notification_queue(user_id, created_at);
