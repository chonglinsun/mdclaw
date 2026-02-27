// mdclaw agent-runner: entry point for containerized Claude agent execution

import { query, type ClaudeCodeResult } from '@anthropic-ai/claude-code';
import fs from 'node:fs';
import path from 'node:path';
import { MessageStream } from './message-stream.js';
import { writeIpcCommand } from './ipc-writer.js';
import { archiveTranscript } from './transcript.js';
import { sanitizeEnv } from './security-hooks.js';

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
 * Builds the system prompt with MCP tool descriptions.
 * The agent gets context about available tools via the system prompt
 * since we use the Claude Code SDK (which handles MCP internally).
 */
function buildSystemPrompt(input: ContainerInput): string {
  const parts: string[] = [];

  parts.push(`You are ${input.assistantName}, a helpful AI assistant.`);
  parts.push(`You are responding in the group "${input.groupFolder}" (chat: ${input.chatJid}).`);
  parts.push('');
  parts.push('## Available actions');
  parts.push('');
  parts.push('To send a message to the chat, use the send_message MCP tool.');
  parts.push('To manage scheduled tasks, use schedule_task, list_tasks, pause_task, resume_task, cancel_task.');

  if (input.isMain) {
    parts.push('You are in the MAIN GROUP with admin privileges.');
    parts.push('You can register new groups with register_group and list them with list_groups.');
  } else {
    parts.push('You are in a non-main group with restricted permissions.');
    parts.push('You can only manage tasks belonging to this group.');
  }

  if (input.isScheduledTask) {
    parts.push('');
    parts.push('This is a SCHEDULED TASK execution. Complete the task and send any output via send_message.');
  }

  return parts.join('\n');
}

/**
 * Main entry point. Reads input, runs Claude Agent SDK session,
 * handles multi-turn follow-ups, and archives transcript on exit.
 */
async function main(): Promise<void> {
  // 1. Read input from stdin
  const input = await readStdin();

  // 2. Set API key from secrets (don't pollute process.env broadly)
  if (input.secrets.ANTHROPIC_API_KEY) {
    process.env.ANTHROPIC_API_KEY = input.secrets.ANTHROPIC_API_KEY;
  }

  // 3. Set up paths
  const ipcDir = '/ipc';
  const dataDir = '/data';
  const sessionsDir = path.join(dataDir, 'sessions');

  // 4. Write MCP tool config for the agent
  // Instead of running a separate MCP server process, we provide tools
  // via the Claude Code SDK's tool system
  const systemPrompt = buildSystemPrompt(input);

  // 5. Prepare allowed tools
  const allowedTools = [
    'bash',
    'computer',
    'editor',
    'mcp__*',
  ];

  // 6. Set up the message stream for multi-turn
  const messageStream = new MessageStream(ipcDir);

  // 7. Sanitize environment for subprocess spawning
  const cleanEnv = sanitizeEnv(process.env as Record<string, string | undefined>);

  // 8. Run initial prompt through Claude Code SDK
  let conversationLog = '';

  try {
    const result: ClaudeCodeResult = await query({
      prompt: input.prompt,
      systemPrompt,
      allowedTools,
      options: {
        maxTurns: 50,
      },
    });

    // Process result — extract text content
    const textParts: string[] = [];
    for (const block of result) {
      if ('text' in block && typeof block.text === 'string') {
        textParts.push(block.text);
      }
    }

    const response = textParts.join('\n');
    if (response) {
      emitOutput(response);
      conversationLog += `## User\n${input.prompt}\n\n## Assistant\n${response}\n\n`;
    }

    // 9. Multi-turn: listen for follow-up messages
    if (!input.isScheduledTask) {
      messageStream.start();

      for await (const msg of messageStream) {
        const followUpPrompt = `[${msg.sender_name}]: ${msg.content}`;

        try {
          const followUpResult: ClaudeCodeResult = await query({
            prompt: followUpPrompt,
            systemPrompt,
            allowedTools,
            options: {
              maxTurns: 50,
            },
          });

          const followUpParts: string[] = [];
          for (const block of followUpResult) {
            if ('text' in block && typeof block.text === 'string') {
              followUpParts.push(block.text);
            }
          }

          const followUpResponse = followUpParts.join('\n');
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
    // 10. Archive transcript
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
