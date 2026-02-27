// mdclaw agent-runner: follow-up message stream for multi-turn conversations

import fs from 'node:fs';
import path from 'node:path';

const INPUT_POLL_INTERVAL = 500; // ms

export interface FollowUpMessage {
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
}

/**
 * Async iterable that polls the IPC input directory for follow-up messages.
 * The host writes JSON files to /ipc/input/ when new messages arrive
 * for a group with an active container. A `_close` sentinel file
 * signals the stream to end.
 */
export class MessageStream implements AsyncIterable<FollowUpMessage> {
  private inputDir: string;
  private closed = false;
  private pendingResolve: ((result: IteratorResult<FollowUpMessage>) => void) | null = null;
  private messageQueue: FollowUpMessage[] = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(ipcDir: string) {
    this.inputDir = path.join(ipcDir, 'input');
    fs.mkdirSync(this.inputDir, { recursive: true });
  }

  /**
   * Start polling for new messages.
   */
  start(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => this.poll(), INPUT_POLL_INTERVAL);
  }

  /**
   * Stop polling and close the stream.
   */
  stop(): void {
    this.closed = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    // Resolve any pending iterator with done
    if (this.pendingResolve) {
      this.pendingResolve({ value: undefined as unknown as FollowUpMessage, done: true });
      this.pendingResolve = null;
    }
  }

  private poll(): void {
    if (this.closed) return;

    let files: string[];
    try {
      if (!fs.existsSync(this.inputDir)) return;
      files = fs.readdirSync(this.inputDir).sort();
    } catch {
      return;
    }

    for (const file of files) {
      const filePath = path.join(this.inputDir, file);

      // Check for close sentinel
      if (file === '_close') {
        try { fs.unlinkSync(filePath); } catch {}
        this.stop();
        return;
      }

      if (!file.endsWith('.json')) continue;

      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const msg = JSON.parse(raw) as FollowUpMessage;
        fs.unlinkSync(filePath);

        if (this.pendingResolve) {
          const resolve = this.pendingResolve;
          this.pendingResolve = null;
          resolve({ value: msg, done: false });
        } else {
          this.messageQueue.push(msg);
        }
      } catch {
        // Skip malformed files
        try { fs.unlinkSync(filePath); } catch {}
      }
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<FollowUpMessage> {
    return {
      next: (): Promise<IteratorResult<FollowUpMessage>> => {
        // If we already have queued messages, return immediately
        if (this.messageQueue.length > 0) {
          const msg = this.messageQueue.shift()!;
          return Promise.resolve({ value: msg, done: false });
        }

        // If closed, signal done
        if (this.closed) {
          return Promise.resolve({ value: undefined as unknown as FollowUpMessage, done: true });
        }

        // Wait for next message
        return new Promise<IteratorResult<FollowUpMessage>>((resolve) => {
          this.pendingResolve = resolve;
        });
      },

      return: (): Promise<IteratorResult<FollowUpMessage>> => {
        this.stop();
        return Promise.resolve({ value: undefined as unknown as FollowUpMessage, done: true });
      },
    };
  }
}
