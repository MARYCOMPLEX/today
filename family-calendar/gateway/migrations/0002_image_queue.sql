ALTER TABLE notification_queue ADD COLUMN kind TEXT NOT NULL DEFAULT 'text';
ALTER TABLE notification_queue ADD COLUMN image_key TEXT;
