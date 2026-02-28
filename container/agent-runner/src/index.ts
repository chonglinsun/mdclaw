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
  parts.push('## Collaboration');
  parts.push('');
  parts.push('For complex multi-step work, you have access to agent collaboration tools (Task, TaskList, etc.) that let you spawn sub-agents to work in parallel. Use them when a task is large enough to benefit from decomposition.');

  return parts.join('\n');
}

/**
 * Main entry point. Reads input, runs Claude Agent SDK session,
 * handles multi-turn follow-ups, and archives transcript on exit.
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

  // 7. Set up the message stream for multi-turn
  const messageStream = new MessageStream(ipcDir);

  // 8. Run initial prompt through Claude Code SDK
  let conversationLog = '';

  try {
    const queryOptions = {
      allowedTools,
      customSystemPrompt: systemPrompt,
      maxTurns: 15,
      permissionMode: 'bypassPermissions' as const,
      env: sdkEnv,
      mcpServers: {
        mdclaw: {
          type: 'sdk' as const,
          name: 'mdclaw',
          instance: mcpServer,
        },
      },
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [createSanitizeBashHook()] }],
      },
    };

    const stream = query({
      prompt: input.prompt,
      options: queryOptions,
    });

    // Process streamed messages — extract text, session ID, and last assistant UUID for resume
    let response = '';
    let sdkSessionId: string | undefined;
    let lastAssistantUuid: string | undefined;
    for await (const message of stream) {
      // Capture the SDK's session ID from any message (all carry it)
      if ('session_id' in message && message.session_id) {
        sdkSessionId = message.session_id as string;
      }

      if (message.type === 'assistant' && 'message' in message) {
        // Track the last assistant message UUID for precise resume
        if ('uuid' in message && message.uuid) {
          lastAssistantUuid = message.uuid as string;
        }
        // Extract text blocks from assistant messages as they arrive
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

    if (response) {
      emitOutput(response);
      conversationLog += `## User\n${input.prompt}\n\n## Assistant\n${response}\n\n`;
    }

    // 10. Multi-turn: listen for follow-up messages with session continuity
    // Use the SDK's own session ID (not the host's) so resume finds prior context
    if (!input.isScheduledTask && sdkSessionId) {
      messageStream.start();

      for await (const msg of messageStream) {
        const followUpPrompt = `[${msg.sender_name}]: ${msg.content}`;

        try {
          const followUpStream = query({
            prompt: followUpPrompt,
            options: {
              ...queryOptions,
              resume: sdkSessionId,
              ...(lastAssistantUuid ? { resumeSessionAt: lastAssistantUuid } : {}),
            },
          });

          let followUpResponse = '';
          for await (const message of followUpStream) {
            // Update last assistant UUID for next resume
            if (message.type === 'assistant' && 'uuid' in message && message.uuid) {
              lastAssistantUuid = message.uuid as string;
            }
            if (message.type === 'result' && message.subtype === 'success' && 'result' in message) {
              followUpResponse = message.result;
            }
          }

          if (followUpResponse) {
            emitOutput(followUpResponse);
            conversationLog += `## User (${msg.sender_name})\n${msg.content}\n\n## Assistant\n${followUpResponse}\n\n`;
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          process.stderr.write(`Follow-up error: ${errMsg}\n`);
        }
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Agent error: ${errMsg}\n`);
    emitOutput(`I encountered an error: ${errMsg}`);
  } finally {
    // 11. Archive transcript
    messageStream.stop();

    if (conversationLog) {
      try {
        archiveTranscript(sessionsDir, input.groupFolder, conversationLog);
      } catch {
        // Non-fatal — transcript archival is best-effort
      }
    }
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
