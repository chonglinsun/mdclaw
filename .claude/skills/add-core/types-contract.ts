// mdclaw anchor file: TypeScript interface contracts
// This file is the single source of truth for all types across skills.
// Skills MUST copy these interfaces verbatim into src/types.ts.

export interface AdditionalMount {
  hostPath: string;
  containerPath?: string;
  readonly?: boolean;
}

export interface MountAllowlist {
  allowedRoots: AllowedRoot[];
  blockedPatterns: string[];
  nonMainReadOnly: boolean;
}

export interface AllowedRoot {
  path: string;
  allowReadWrite: boolean;
  description?: string;
}

export interface ContainerConfig {
  additionalMounts?: AdditionalMount[];
  timeout?: number;
}

export interface RegisteredGroup {
  name: string;
  folder: string;
  trigger: string;
  added_at: string;
  containerConfig?: ContainerConfig;
  requiresTrigger?: boolean;
}

export interface NewMessage {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me?: boolean;
  is_bot_message?: boolean;
}

export interface ScheduledTask {
  id: string;
  group_folder: string;
  chat_jid: string;
  prompt: string;
  schedule_type: 'cron' | 'interval' | 'once';
  schedule_value: string;
  context_mode: 'group' | 'isolated';
  next_run: string | null;
  last_run: string | null;
  last_result: string | null;
  status: 'active' | 'paused' | 'completed';
  created_at: string;
}

export interface TaskRunLog {
  task_id: string;
  run_at: string;
  duration_ms: number;
  status: 'success' | 'error';
  result: string | null;
  error: string | null;
}

export interface Channel {
  name: string;
  connect(): Promise<void>;
  sendMessage(jid: string, text: string): Promise<void>;
  isConnected(): boolean;
  ownsJid(jid: string): boolean;
  disconnect(): Promise<void>;
  setTyping?(jid: string, isTyping: boolean): Promise<void>;
}

export type OnInboundMessage = (chatJid: string, message: NewMessage) => void;

export type OnChatMetadata = (
  chatJid: string,
  timestamp: string,
  name?: string,
  channel?: string,
  isGroup?: boolean,
) => void;

export interface QueuedTask {
  id: string;
  groupJid: string;
  fn: () => Promise<void>;
}

export interface GroupState {
  processing: boolean;
  pending: QueuedTask[];
  currentProcess: { kill: () => void } | null;
  retryCount: number;
}

export interface ContainerResult {
  output: string;
  exitCode: number;
  timedOut: boolean;
}

export interface IpcCommand {
  type: 'schedule_task' | 'pause_task' | 'resume_task' | 'cancel_task' | 'refresh_groups' | 'register_group';
  payload: Record<string, unknown>;
  source_group: string;
}

export interface ContainerInput {
  prompt: string;
  sessionId: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask: boolean;
  assistantName: string;
  secrets: Record<string, string>;
}

export interface AppState {
  lastProcessed: Record<string, string>;
  sessions: Record<string, string>;
  registeredGroups: RegisteredGroup[];
}
