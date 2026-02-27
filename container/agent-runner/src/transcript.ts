// mdclaw agent-runner: transcript archiving

import fs from 'node:fs';
import path from 'node:path';

/**
 * Archives the current conversation transcript to a timestamped markdown file.
 * Called before session compaction to preserve conversation history.
 *
 * @param sessionsDir - Path to the sessions directory (e.g., /data/sessions)
 * @param groupFolder - The group's folder name
 * @param transcript - The conversation content to archive
 */
export function archiveTranscript(
  sessionsDir: string,
  groupFolder: string,
  transcript: string,
): string {
  const conversationsDir = path.join(sessionsDir, groupFolder, 'conversations');
  fs.mkdirSync(conversationsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${timestamp}.md`;
  const filePath = path.join(conversationsDir, filename);

  const header = [
    `# Conversation Archive`,
    ``,
    `- **Group:** ${groupFolder}`,
    `- **Archived:** ${new Date().toISOString()}`,
    ``,
    `---`,
    ``,
  ].join('\n');

  fs.writeFileSync(filePath, header + transcript);

  return filePath;
}

/**
 * Lists archived transcripts for a group, sorted newest first.
 */
export function listTranscripts(sessionsDir: string, groupFolder: string): string[] {
  const conversationsDir = path.join(sessionsDir, groupFolder, 'conversations');
  if (!fs.existsSync(conversationsDir)) return [];

  return fs.readdirSync(conversationsDir)
    .filter(f => f.endsWith('.md'))
    .sort()
    .reverse();
}
