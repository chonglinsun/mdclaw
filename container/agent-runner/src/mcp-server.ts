// mdclaw agent-runner: MCP tool server for container-side operations

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { writeIpcCommand } from './ipc-writer.js';

const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

export interface McpServerConfig {
  groupFolder: string;
  chatJid: string;
  ipcDir: string;
  isMain: boolean;
  assistantName: string;
  outputStream: NodeJS.WritableStream;
}

/**
 * Creates and configures the MCP server with all mdclaw tools.
 * Tools communicate with the host via sentinel-marked stdout (for messages)
 * and IPC file writes (for task/group management).
 */
export function createMcpServer(config: McpServerConfig): McpServer {
  const server = new McpServer({
    name: 'mdclaw',
    version: '0.1.0',
  });

  // --- send_message ---
  // Writes a sentinel-marked message to stdout for the host to capture and deliver.
  server.tool(
    'send_message',
    'Send a message to the current chat immediately. Useful for acknowledgments or progress updates while still working.',
    {
      text: z.string().describe('The message text to send'),
      sender: z.string().optional().describe('Optional sender identity (e.g., "Researcher"). Used by Telegram swarm for per-agent bot names.'),
    },
    async ({ text }) => {
      const output = `\n${OUTPUT_START_MARKER}\n${text}\n${OUTPUT_END_MARKER}\n`;
      config.outputStream.write(output);
      return { content: [{ type: 'text' as const, text: `Message sent: "${text.slice(0, 100)}${text.length > 100 ? '...' : ''}"` }] };
    },
  );

  // --- schedule_task ---
  server.tool(
    'schedule_task',
    'Schedule a recurring or one-time task. Types: "cron" (cron expression), "interval" (milliseconds), "once" (ISO timestamp).',
    {
      prompt: z.string().describe('The prompt to execute when the task runs'),
      schedule_type: z.enum(['cron', 'interval', 'once']).describe('Type of schedule'),
      schedule_value: z.string().describe('Cron expression, interval in ms, or ISO timestamp'),
      context_mode: z.enum(['group', 'isolated']).optional().default('group').describe('Whether to include group context'),
    },
    async ({ prompt, schedule_type, schedule_value, context_mode }) => {
      writeIpcCommand(config.ipcDir, {
        type: 'schedule_task',
        payload: {
          prompt,
          schedule_type,
          schedule_value,
          context_mode,
          chat_jid: config.chatJid,
        },
        source_group: config.groupFolder,
      });
      return { content: [{ type: 'text' as const, text: `Task scheduled: ${schedule_type} "${prompt.slice(0, 80)}"` }] };
    },
  );

  // --- list_tasks ---
  server.tool(
    'list_tasks',
    'List all scheduled tasks for the current group.',
    {},
    async () => {
      const tasksFile = path.join(config.ipcDir, 'current_tasks.json');
      let tasks: Array<Record<string, unknown>> = [];
      try {
        if (fs.existsSync(tasksFile)) {
          tasks = JSON.parse(fs.readFileSync(tasksFile, 'utf-8')) as Array<Record<string, unknown>>;
        }
      } catch {
        // File may not exist yet
      }

      if (tasks.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No scheduled tasks.' }] };
      }

      const summary = tasks.map((t, i) =>
        `${i + 1}. [${t.status}] ${t.prompt} (${t.schedule_type}: ${t.schedule_value}) — id: ${t.id}`
      ).join('\n');

      return { content: [{ type: 'text' as const, text: summary }] };
    },
  );

  // --- pause_task ---
  server.tool(
    'pause_task',
    'Pause an active scheduled task.',
    {
      task_id: z.string().describe('The ID of the task to pause'),
    },
    async ({ task_id }) => {
      writeIpcCommand(config.ipcDir, {
        type: 'pause_task',
        payload: { task_id },
        source_group: config.groupFolder,
      });
      return { content: [{ type: 'text' as const, text: `Task ${task_id} pause requested.` }] };
    },
  );

  // --- resume_task ---
  server.tool(
    'resume_task',
    'Resume a paused scheduled task.',
    {
      task_id: z.string().describe('The ID of the task to resume'),
    },
    async ({ task_id }) => {
      writeIpcCommand(config.ipcDir, {
        type: 'resume_task',
        payload: { task_id },
        source_group: config.groupFolder,
      });
      return { content: [{ type: 'text' as const, text: `Task ${task_id} resume requested.` }] };
    },
  );

  // --- cancel_task ---
  server.tool(
    'cancel_task',
    'Cancel a scheduled task permanently.',
    {
      task_id: z.string().describe('The ID of the task to cancel'),
    },
    async ({ task_id }) => {
      writeIpcCommand(config.ipcDir, {
        type: 'cancel_task',
        payload: { task_id },
        source_group: config.groupFolder,
      });
      return { content: [{ type: 'text' as const, text: `Task ${task_id} cancel requested.` }] };
    },
  );

  // --- register_group (main group only) ---
  if (config.isMain) {
    server.tool(
      'register_group',
      'Register a new group for the assistant to monitor. Main group only.',
      {
        name: z.string().describe('Display name for the group'),
        folder: z.string().describe('Folder name for group data (alphanumeric, hyphens, underscores)'),
        trigger: z.string().optional().default(`@${config.assistantName}`).describe('Trigger pattern'),
        chat_jid: z.string().describe('Chat JID to associate with this group'),
      },
      async ({ name, folder, trigger, chat_jid }) => {
        writeIpcCommand(config.ipcDir, {
          type: 'register_group',
          payload: { name, folder, trigger, chat_jid },
          source_group: config.groupFolder,
        });
        return { content: [{ type: 'text' as const, text: `Group "${name}" (${folder}) registration requested.` }] };
      },
    );

    // --- list_groups (main group only, read from available_groups.json) ---
    server.tool(
      'list_groups',
      'List all registered groups. Main group only.',
      {},
      async () => {
        const groupsFile = path.join(config.ipcDir, 'available_groups.json');
        let groups: Array<Record<string, unknown>> = [];
        try {
          if (fs.existsSync(groupsFile)) {
            groups = JSON.parse(fs.readFileSync(groupsFile, 'utf-8')) as Array<Record<string, unknown>>;
          }
        } catch {
          // File may not exist yet
        }

        if (groups.length === 0) {
          return { content: [{ type: 'text' as const, text: 'No registered groups.' }] };
        }

        const summary = groups.map((g, i) =>
          `${i + 1}. ${g.name} (${g.folder}) — trigger: ${g.trigger}`
        ).join('\n');

        return { content: [{ type: 'text' as const, text: summary }] };
      },
    );
  }

  return server;
}

/**
 * Starts the MCP server on a stdio transport.
 * Returns a cleanup function.
 */
export async function startMcpServer(config: McpServerConfig): Promise<{ server: McpServer; close: () => Promise<void> }> {
  const server = createMcpServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  return {
    server,
    close: async () => {
      await server.close();
    },
  };
}
