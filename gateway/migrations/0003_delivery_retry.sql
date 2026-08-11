ALTER TABLE notification_queue ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notification_queue ADD COLUMN next_attempt_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notification_queue ADD COLUMN last_error TEXT;
ALTER TABLE notification_queue ADD COLUMN failed_at INTEGER;

UPDATE notification_queue SET text = '' WHERE kind = 'image';

CREATE INDEX notification_queue_due_idx
  ON notification_queue(user_id, failed_at, next_attempt_at, created_at);
