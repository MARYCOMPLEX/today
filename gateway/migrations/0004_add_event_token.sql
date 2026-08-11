-- 添加日期功能：临时 token 表（微信命令「添加日期」生成，15 分钟有效）
CREATE TABLE IF NOT EXISTS add_event_token (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS add_event_token_user_idx ON add_event_token(user_id);
