// mdclaw agent-runner: push-based async iterable for streaming user messages to the SDK.
// Keeps the iterable alive until end() is called, preventing isSingleUserTurn.
// Follow-up IPC messages are pushed into the stream during the query.

import type { SDKUserMessage } from '@anthropic-ai/claude-code';

/**
 * Push-based async iterable that yields SDKUserMessage objects.
 * Used as `prompt: stream` in query() to enable multi-turn within a single call.
 *
 * Flow:
 *   1. push(text) the initial prompt
 *   2. Pass this as `prompt` to query()
 *   3. A background poller pushes IPC follow-up messages via push()
 *   4. end() terminates the iterable when _close sentinel arrives
 */
export class MessageStream {
  private queue: SDKUserMessage[] = [];
  private waiting: (() => void) | null = null;
  private done = false;

  push(text: string): void {
    this.queue.push({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      session_id: '',
    } as SDKUserMessage);
    this.waiting?.();
  }

  end(): void {
    this.done = true;
    this.waiting?.();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage> {
    while (true) {
      while (this.queue.length > 0) {
        yield this.queue.shift()!;
      }
      if (this.done) return;
      await new Promise<void>((r) => { this.waiting = r; });
      this.waiting = null;
    }
  }
}
