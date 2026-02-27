// mdclaw agent-runner: atomic IPC command writer

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface IpcCommand {
  type: string;
  payload: Record<string, unknown>;
  source_group: string;
}

/**
 * Writes an IPC command file atomically (write to .tmp, then rename).
 * Filename format: ${timestamp}-${random}.json
 */
export function writeIpcCommand(ipcDir: string, command: IpcCommand): string {
  const tasksDir = path.join(ipcDir, 'tasks');
  fs.mkdirSync(tasksDir, { recursive: true });

  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString('hex');
  const filename = `${timestamp}-${random}.json`;
  const tmpPath = path.join(tasksDir, `.${filename}.tmp`);
  const finalPath = path.join(tasksDir, filename);

  fs.writeFileSync(tmpPath, JSON.stringify(command, null, 2));
  fs.renameSync(tmpPath, finalPath);

  return finalPath;
}
