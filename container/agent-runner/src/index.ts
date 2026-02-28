// mdclaw agent-runner: entry point for containerized Claude agent execution

import { query } from '@anthropic-ai/claude-code';
import fs from 'node:fs';
import path from 'node:path';
import { MessageStream } from './message-stream.js';
import { writeIpcCommand } from './ipc-writer.js';
import { archiveTranscript } from './transcript.js';
import { createSanitizeBashHook } from './security-hooks.js';
import { createMcpServer, type McpServerConfig } from './mcp-server.js';

const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

const IPC_POLL_MS = 500;

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

/**
 * Reads JSON input from stdin. The host sends a ContainerInput object
 * with the prompt, session info, and secrets.
 */
async function readStdin(): Promise<ContainerInput> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(data) as ContainerInput);
      } catch (err) {
        reject(new Error(`Failed to parse stdin JSON: ${err}`));
      }
    });
    process.stdin.on('error', reject);
  });
}

/**
 * Emits a sentinel-marked output block to stdout.
 * The host parses these markers to extract messages for delivery.
 */
function emitOutput(text: string): void {
  process.stdout.write(`\n${OUTPUT_START_MARKER}\n${text}\n${OUTPUT_END_MARKER}\n`);
}

/**
 * Reads an optional personality file from the data directory.
 * Returns empty string if not found.
 */
function readPersonalityFile(filePath: string): string {
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8').trim();
    }
  } catch {
    // Non-fatal — personality files are optional
  }
  return '';
}

/**
 * Builds the system prompt with personality, identity, and context.
 * MCP tools are wired directly via the SDK — no need to describe them in prose.
 */
function buildSystemPrompt(input: ContainerInput): string {
  const parts: string[] = [];

  // Personality files: IDENTITY.md and SOUL.md from mounted /data/
  const identity = readPersonalityFile('/data/IDENTITY.md');
  const soul = readPersonalityFile('/data/SOUL.md');

  if (identity) {
    parts.push(identity);
    parts.push('');
  }

  if (soul) {
    parts.push(soul);
    parts.push('');
  }

  // Session summaries from previous conversations
  const sessionsIndex = readPersonalityFile('/data/sessions-index.json');
  if (sessionsIndex) {
    try {
      const sessions = JSON.parse(sessionsIndex) as Array<{ summary?: string }>;
      const summaries = sessions
        .filter((s) => s.summary)
        .map((s) => s.summary)
        .slice(-5);
      if (summaries.length > 0) {
        parts.push('## Recent conversation context');
        parts.push(summaries.join('\n'));
        parts.push('');
      }
    } catch {
      // Non-fatal — sessions index may be malformed
    }
  }

  parts.push(`You are ${input.assistantName}, a helpful AI assistant.`);
  parts.push(`You are responding in the group "${input.groupFolder}" (chat: ${input.chatJid}).`);

  if (input.isMain) {
    parts.push('You are in the MAIN GROUP with admin privileges.');
  } else {
    parts.push('You are in a non-main group with restricted permissions.');
  }

  if (input.isScheduledTask) {
    parts.push('');
    parts.push('This is a SCHEDULED TASK execution. Complete the task and send any output via send_message.');
  }

  parts.push('');
  parts.push('## Communication');
  parts.push('');
  parts.push('Your output is sent to the user or group.');
  parts.push('');
  parts.push('You also have `send_message` which sends a message immediately while you are still working. This is useful when you want to acknowledge a request before starting longer work, or to send intermediate progress updates.');

  parts.push('');
  parts.push('## Collaboration');
  parts.push('');
  parts.push('For complex multi-step work, you have access to agent collaboration tools (Task, TaskList, etc.) that let you spawn sub-agents to work in parallel. Use them when a task is large enough to benefit from decomposition.');

  return parts.join('\n');
}

/**
 * Drains all pending IPC input messages from the input directory.
 * Returns an array of formatted message strings.
 */
function drainIpcInput(inputDir: string): string[] {
  const messages: string[] = [];
  try {
    if (!fs.existsSync(inputDir)) return messages;
    const files = fs.readdirSync(inputDir).sort();

    for (const file of files) {
      if (file === '_close' || !file.endsWith('.json')) continue;
      const filePath = path.join(inputDir, file);
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const msg = JSON.parse(raw) as { sender_name?: string; content?: string; text?: string };
        fs.unlinkSync(filePath);
        // Support both { sender_name, content } and { text } formats
        const text = msg.content || msg.text || '';
        const sender = msg.sender_name || 'User';
        if (text) {
          messages.push(`[${sender}]: ${text}`);
        }
      } catch {
        try { fs.unlinkSync(path.join(inputDir, file)); } catch {}
      }
    }
  } catch {
    // Non-fatal
  }
  return messages;
}

/**
 * Checks if the _close sentinel file exists in the input directory.
 */
function shouldClose(inputDir: string): boolean {
  try {
    const closePath = path.join(inputDir, '_close');
    if (fs.existsSync(closePath)) {
      fs.unlinkSync(closePath);
      return true;
    }
  } catch {
    // Non-fatal
  }
  return false;
}

/**
 * Main entry point. Reads input, runs Claude Agent SDK session
 * with a push-based message stream for multi-turn, and archives transcript.
 */
async function main(): Promise<void> {
  // 1. Read input from stdin
  const input = await readStdin();

  // 2. Build SDK environment with secrets — never mutate process.env.
  // Secrets are merged into a clone of process.env and passed exclusively
  // via options.env. This keeps process.env clean so any code that spawns
  // subprocesses outside the SDK won't leak API keys.
  let secrets = input.secrets;
  if (!secrets || Object.keys(secrets).length === 0) {
    try {
      if (fs.existsSync('/secrets.json')) {
        secrets = JSON.parse(fs.readFileSync('/secrets.json', 'utf-8'));
      }
    } catch {
      // Non-fatal — secrets file may not exist (Docker runtime uses -e instead)
    }
  }
  const sdkEnv: Record<string, string | undefined> = { ...process.env };
  for (const [key, value] of Object.entries(secrets)) {
    if (value) {
      sdkEnv[key] = value;
    }
  }

  // 3. Set up paths
  const ipcDir = '/ipc';
  const dataDir = '/data';
  const sessionsDir = path.join(dataDir, 'sessions');
  const inputDir = path.join(ipcDir, 'input');
  fs.mkdirSync(inputDir, { recursive: true });

  // 4. Create MCP server instance for tool access
  const mcpConfig: McpServerConfig = {
    groupFolder: input.groupFolder,
    chatJid: input.chatJid,
    ipcDir,
    isMain: input.isMain,
    assistantName: input.assistantName,
    outputStream: process.stdout,
  };
  const mcpServer = createMcpServer(mcpConfig);

  // 5. Build system prompt (no tool descriptions — MCP tools are wired directly)
  const systemPrompt = buildSystemPrompt(input);

  // 6. Prepare allowed tools
  const allowedTools = [
    'bash',
    'computer',
    'editor',
    'mcp__*',
  ];

  // 7. Run query with push-based message stream
  let conversationLog = '';
  let sessionId: string | undefined;
  let resumeAt: string | undefined;

  try {
    // Query loop: run query → wait for IPC message → run query with resume → repeat
    // Most follow-ups are piped into the stream during a single query() call.
    // The outer loop only fires when the query finishes and a new message arrives later.
    while (true) {
      // Create a push-based message stream and pipe the initial prompt
      const stream = new MessageStream();
      stream.push(input.prompt);

      // Poll IPC for follow-up messages during the query (non-scheduled only)
      let ipcPolling = !input.isScheduledTask;
      let closedDuringQuery = false;
      const pollIpc = (): void => {
        if (!ipcPolling) return;
        if (shouldClose(inputDir)) {
          closedDuringQuery = true;
          stream.end();
          ipcPolling = false;
          return;
        }
        const messages = drainIpcInput(inputDir);
        for (const text of messages) {
          stream.push(text);
        }
        setTimeout(pollIpc, IPC_POLL_MS);
      };
      if (ipcPolling) {
        setTimeout(pollIpc, IPC_POLL_MS);
      }

      // Create a fresh MCP server for each query() call
      const currentMcpServer = sessionId ? createMcpServer(mcpConfig) : mcpServer;

      const queryStream = query({
        prompt: stream,
        options: {
          allowedTools,
          customSystemPrompt: systemPrompt,
          maxTurns: 15,
          permissionMode: 'bypassPermissions' as const,
          env: sdkEnv,
          mcpServers: {
            mdclaw: {
              type: 'sdk' as const,
              name: 'mdclaw',
              instance: currentMcpServer,
            },
          },
          hooks: {
            PreToolUse: [{ matcher: 'Bash', hooks: [createSanitizeBashHook()] }],
          },
          ...(sessionId ? { resume: sessionId } : {}),
          ...(resumeAt ? { resumeSessionAt: resumeAt } : {}),
        },
      });

      // Process streamed messages
      let response = '';
      for await (const message of queryStream) {
        // Capture session ID from any message
        if ('session_id' in message && message.session_id) {
          sessionId = message.session_id as string;
        }
        // Track last assistant UUID for precise resume
        if (message.type === 'assistant' && 'uuid' in message && message.uuid) {
          resumeAt = message.uuid as string;
        }
        // Extract text from assistant messages
        if (message.type === 'assistant' && 'message' in message) {
          const msg = message.message as { content?: Array<{ type: string; text?: string }> };
          if (msg.content) {
            for (const block of msg.content) {
              if (block.type === 'text' && block.text) {
                response = block.text;
              }
            }
          }
        } else if (message.type === 'result' && message.subtype === 'success' && 'result' in message) {
          response = message.result;
        }
      }

      // Stop IPC polling for this query
      ipcPolling = false;

      if (response) {
        emitOutput(response);
        conversationLog += `## User\n${input.prompt}\n\n## Assistant\n${response}\n\n`;
      }

      // If close sentinel arrived during query, or scheduled task, we're done
      if (closedDuringQuery || input.isScheduledTask) {
        break;
      }

      // Wait for the next IPC message or _close sentinel
      const nextMessage = await waitForNextMessage(inputDir);
      if (nextMessage === null) {
        break; // _close sentinel
      }

      // Set up next iteration with the follow-up prompt
      input.prompt = nextMessage;
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Agent error: ${errMsg}\n`);
    emitOutput(`I encountered an error: ${errMsg}`);
  } finally {
    if (conversationLog) {
      try {
        archiveTranscript(sessionsDir, input.groupFolder, conversationLog);
      } catch {
        // Non-fatal — transcript archival is best-effort
      }
    }
  }
}

/**
 * Waits for the next IPC message or _close sentinel.
 * Returns the formatted message string, or null if _close received.
 */
function waitForNextMessage(inputDir: string): Promise<string | null> {
  return new Promise((resolve) => {
    const poll = (): void => {
      if (shouldClose(inputDir)) {
        resolve(null);
        return;
      }
      const messages = drainIpcInput(inputDir);
      if (messages.length > 0) {
        resolve(messages[0]);
        return;
      }
      setTimeout(poll, IPC_POLL_MS);
    };
    poll();
  });
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
