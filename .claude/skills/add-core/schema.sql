-- mdclaw anchor file: Database schema
-- This file is the single source of truth for all tables across skills.
-- Skills MUST use these CREATE TABLE statements verbatim in src/db.ts.

CREATE TABLE IF NOT EXISTS chats (
  jid TEXT PRIMARY KEY,
  name TEXT,
  last_activity TEXT NOT NULL,
  channel TEXT DEFAULT 'whatsapp',
  is_group INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_chats_last_activity ON chats(last_activity);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_jid TEXT NOT NULL,
  sender TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  is_from_me INTEGER DEFAULT 0,
  is_bot_message INTEGER DEFAULT 0,
  FOREIGN KEY (chat_jid) REFERENCES chats(jid)
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_jid ON messages(chat_jid);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);

CREATE TABLE IF NOT EXISTS registered_groups (
  folder TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  jid TEXT,
  trigger TEXT NOT NULL DEFAULT '@Andy',
  added_at TEXT NOT NULL,
  container_config TEXT,
  requires_trigger INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS router_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  group_folder TEXT PRIMARY KEY,
  session_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id TEXT PRIMARY KEY,
  group_folder TEXT NOT NULL,
  chat_jid TEXT NOT NULL,
  prompt TEXT NOT NULL,
  schedule_type TEXT NOT NULL CHECK(schedule_type IN ('cron', 'interval', 'once')),
  schedule_value TEXT NOT NULL,
  context_mode TEXT NOT NULL DEFAULT 'group' CHECK(context_mode IN ('group', 'isolated')),
  next_run TEXT,
  last_run TEXT,
  last_result TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'completed')),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_status ON scheduled_tasks(status);
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next_run ON scheduled_tasks(next_run);

CREATE TABLE IF NOT EXISTS task_run_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  run_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('success', 'error')),
  result TEXT,
  error TEXT,
  FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id)
);

CREATE INDEX IF NOT EXISTS idx_task_run_logs_task_id ON task_run_logs(task_id);
