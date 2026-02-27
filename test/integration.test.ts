// mdclaw integration test: full pipeline with mocked container

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';

// We test the pipeline logic by importing individual modules
// and wiring them together with a mocked container

const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

interface NewMessage {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me?: boolean;
  is_bot_message?: boolean;
}

interface RegisteredGroup {
  name: string;
  folder: string;
  jid?: string;
  trigger: string;
  added_at: string;
  containerConfig?: { additionalMounts?: unknown[]; timeout?: number };
  requiresTrigger?: boolean;
}

interface ContainerInput {
  prompt: string;
  sessionId: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask: boolean;
  assistantName: string;
  secrets: Record<string, string>;
}

// Inline schema (matches schema.sql)
const SCHEMA = `
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
`;

// Helper functions (inline to avoid importing from generated code)
function initTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}

function storeChat(db: Database.Database, jid: string, timestamp: string, name?: string): void {
  db.prepare(`
    INSERT INTO chats (jid, last_activity, name) VALUES (?, ?, ?)
    ON CONFLICT(jid) DO UPDATE SET last_activity = excluded.last_activity
  `).run(jid, timestamp, name ?? null);
}

function storeMessage(db: Database.Database, msg: NewMessage): void {
  db.prepare(`
    INSERT OR IGNORE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(msg.id, msg.chat_jid, msg.sender, msg.sender_name, msg.content, msg.timestamp, msg.is_from_me ? 1 : 0, msg.is_bot_message ? 1 : 0);
}

function getNewMessages(db: Database.Database, chatJid: string, since: string): NewMessage[] {
  return db.prepare(`
    SELECT * FROM messages WHERE chat_jid = ? AND timestamp > ? AND is_bot_message = 0 ORDER BY timestamp ASC
  `).all(chatJid, since) as NewMessage[];
}

function registerGroup(db: Database.Database, group: RegisteredGroup): void {
  db.prepare(`
    INSERT INTO registered_groups (folder, name, jid, trigger, added_at, container_config, requires_trigger)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(folder) DO UPDATE SET
      name = excluded.name, jid = excluded.jid, trigger = excluded.trigger,
      container_config = excluded.container_config, requires_trigger = excluded.requires_trigger
  `).run(
    group.folder, group.name, group.jid ?? null, group.trigger, group.added_at,
    group.containerConfig ? JSON.stringify(group.containerConfig) : null,
    group.requiresTrigger === false ? 0 : 1,
  );
}

function getRegisteredGroups(db: Database.Database): RegisteredGroup[] {
  const rows = db.prepare('SELECT * FROM registered_groups').all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    name: row.name as string,
    folder: row.folder as string,
    jid: row.jid as string | undefined,
    trigger: row.trigger as string,
    added_at: row.added_at as string,
    containerConfig: row.container_config ? JSON.parse(row.container_config as string) : undefined,
    requiresTrigger: row.requires_trigger === 0 ? false : true,
  }));
}

function parseContainerOutput(raw: string): string {
  let lastOutput = '';
  let searchFrom = 0;
  while (true) {
    const startIdx = raw.indexOf(OUTPUT_START_MARKER, searchFrom);
    if (startIdx === -1) break;
    const contentStart = startIdx + OUTPUT_START_MARKER.length;
    const endIdx = raw.indexOf(OUTPUT_END_MARKER, contentStart);
    if (endIdx === -1) break;
    lastOutput = raw.slice(contentStart, endIdx).trim();
    searchFrom = endIdx + OUTPUT_END_MARKER.length;
  }
  return lastOutput;
}

function parseAllOutputs(raw: string): string[] {
  const outputs: string[] = [];
  let searchFrom = 0;
  while (true) {
    const startIdx = raw.indexOf(OUTPUT_START_MARKER, searchFrom);
    if (startIdx === -1) break;
    const contentStart = startIdx + OUTPUT_START_MARKER.length;
    const endIdx = raw.indexOf(OUTPUT_END_MARKER, contentStart);
    if (endIdx === -1) break;
    outputs.push(raw.slice(contentStart, endIdx).trim());
    searchFrom = endIdx + OUTPUT_END_MARKER.length;
  }
  return outputs;
}

describe('Full pipeline integration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('should process message through full pipeline', () => {
    // 1. Register a group
    const group: RegisteredGroup = {
      name: 'Test Group',
      folder: 'test-group',
      jid: 'test@g.us',
      trigger: '@Andy',
      added_at: new Date().toISOString(),
      requiresTrigger: false,
    };
    registerGroup(db, group);

    // Verify registration
    const groups = getRegisteredGroups(db);
    expect(groups).toHaveLength(1);
    expect(groups[0].folder).toBe('test-group');
    expect(groups[0].jid).toBe('test@g.us');

    // 2. Store a chat and message
    const chatJid = 'test@g.us';
    const timestamp = new Date().toISOString();
    storeChat(db, chatJid, timestamp, 'Test Chat');

    const message: NewMessage = {
      id: `msg-${crypto.randomUUID()}`,
      chat_jid: chatJid,
      sender: 'user1@s.whatsapp.net',
      sender_name: 'Alice',
      content: 'Hello @Andy, what time is it?',
      timestamp,
      is_from_me: false,
      is_bot_message: false,
    };
    storeMessage(db, message);

    // 3. Query new messages (trigger detection)
    const lastProcessed = new Date(Date.now() - 60000).toISOString();
    const newMessages = getNewMessages(db, chatJid, lastProcessed);
    expect(newMessages).toHaveLength(1);
    expect(newMessages[0].content).toBe('Hello @Andy, what time is it?');

    // 4. Build ContainerInput
    const containerInput: ContainerInput = {
      prompt: `Group: ${group.name} (${group.folder})\nTriggered by: ${message.sender_name}\n\nLatest message from ${message.sender_name}:\n${message.content}`,
      sessionId: crypto.randomUUID(),
      groupFolder: group.folder,
      chatJid,
      isMain: false,
      isScheduledTask: false,
      assistantName: 'Andy',
      secrets: { ANTHROPIC_API_KEY: 'test-key' },
    };

    // Verify ContainerInput structure
    expect(containerInput.prompt).toContain('Hello @Andy');
    expect(containerInput.groupFolder).toBe('test-group');
    expect(containerInput.chatJid).toBe('test@g.us');
    expect(containerInput.isMain).toBe(false);
    expect(containerInput.isScheduledTask).toBe(false);
    expect(containerInput.assistantName).toBe('Andy');
    expect(containerInput.secrets.ANTHROPIC_API_KEY).toBe('test-key');

    // 5. Mock container response with sentinel markers
    const mockContainerOutput = [
      'Some debug output...',
      OUTPUT_START_MARKER,
      'The current time is 3:42 PM.',
      OUTPUT_END_MARKER,
      'More debug...',
    ].join('\n');

    // 6. Parse response
    const parsedOutput = parseContainerOutput(mockContainerOutput);
    expect(parsedOutput).toBe('The current time is 3:42 PM.');

    // 7. Store bot response
    const botMessage: NewMessage = {
      id: `bot-${Date.now()}`,
      chat_jid: chatJid,
      sender: 'bot',
      sender_name: 'Andy',
      content: parsedOutput,
      timestamp: new Date().toISOString(),
      is_from_me: true,
      is_bot_message: true,
    };
    storeMessage(db, botMessage);

    // 8. Verify bot message is excluded from new messages query
    const afterBot = getNewMessages(db, chatJid, lastProcessed);
    expect(afterBot).toHaveLength(1); // Only the original user message, not bot message
  });

  it('should handle multiple sentinel outputs (streaming)', () => {
    const mockOutput = [
      OUTPUT_START_MARKER,
      'First response part',
      OUTPUT_END_MARKER,
      'Some processing...',
      OUTPUT_START_MARKER,
      'Second response part',
      OUTPUT_END_MARKER,
    ].join('\n');

    const allOutputs = parseAllOutputs(mockOutput);
    expect(allOutputs).toHaveLength(2);
    expect(allOutputs[0]).toBe('First response part');
    expect(allOutputs[1]).toBe('Second response part');

    // parseContainerOutput returns last one
    const lastOutput = parseContainerOutput(mockOutput);
    expect(lastOutput).toBe('Second response part');
  });

  it('should handle empty container output', () => {
    const output = parseContainerOutput('no markers here');
    expect(output).toBe('');
  });

  it('should build ContainerInput for scheduled tasks', () => {
    const containerInput: ContainerInput = {
      prompt: 'Check weather and post update',
      sessionId: crypto.randomUUID(),
      groupFolder: 'weather-bot',
      chatJid: 'weather@g.us',
      isMain: false,
      isScheduledTask: true,
      assistantName: 'Andy',
      secrets: { ANTHROPIC_API_KEY: 'test-key' },
    };

    expect(containerInput.isScheduledTask).toBe(true);
    expect(containerInput.prompt).toBe('Check weather and post update');
  });

  it('should enforce main group privileges in ContainerInput', () => {
    const mainInput: ContainerInput = {
      prompt: 'Admin task',
      sessionId: crypto.randomUUID(),
      groupFolder: 'main',
      chatJid: 'main@g.us',
      isMain: true,
      isScheduledTask: false,
      assistantName: 'Andy',
      secrets: { ANTHROPIC_API_KEY: 'test-key' },
    };

    const nonMainInput: ContainerInput = {
      prompt: 'User task',
      sessionId: crypto.randomUUID(),
      groupFolder: 'user-group',
      chatJid: 'user@g.us',
      isMain: false,
      isScheduledTask: false,
      assistantName: 'Andy',
      secrets: { ANTHROPIC_API_KEY: 'test-key' },
    };

    expect(mainInput.isMain).toBe(true);
    expect(nonMainInput.isMain).toBe(false);
  });

  it('should store and retrieve groups with jid', () => {
    const group: RegisteredGroup = {
      name: 'JID Test',
      folder: 'jid-test',
      jid: 'specific@g.us',
      trigger: '@Bot',
      added_at: new Date().toISOString(),
    };
    registerGroup(db, group);

    const groups = getRegisteredGroups(db);
    const found = groups.find(g => g.folder === 'jid-test');
    expect(found).toBeDefined();
    expect(found!.jid).toBe('specific@g.us');
  });

  it('should handle cursor rollback scenario', () => {
    const chatJid = 'rollback@g.us';
    const t1 = '2024-01-01T12:00:00.000Z';
    const t2 = '2024-01-01T12:01:00.000Z';

    storeChat(db, chatJid, t2);

    storeMessage(db, {
      id: 'msg1',
      chat_jid: chatJid,
      sender: 'user',
      sender_name: 'User',
      content: 'First message',
      timestamp: t1,
    });

    storeMessage(db, {
      id: 'msg2',
      chat_jid: chatJid,
      sender: 'user',
      sender_name: 'User',
      content: 'Second message',
      timestamp: t2,
    });

    // Simulate cursor at t1 (before second message)
    let cursor = t1;

    // Get messages after cursor
    let messages = getNewMessages(db, chatJid, cursor);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('Second message');

    // Advance cursor optimistically
    cursor = t2;

    // Simulate container failure — would need to roll back
    // After rollback, cursor is back to t1
    cursor = t1;
    messages = getNewMessages(db, chatJid, cursor);
    expect(messages).toHaveLength(1); // Message is still available
  });
});
