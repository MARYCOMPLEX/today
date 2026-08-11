-- 添加日期 token 增加 kind 列（add=添加事件 / delete=删除事件）
ALTER TABLE add_event_token ADD COLUMN kind TEXT NOT NULL DEFAULT 'add';
