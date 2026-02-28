---
disable-model-invocation: true
---

# /add-telegram-swarm — Agent Teams with Per-Bot Identity

Extends the Telegram channel with agent swarm support: a pool of additional bot tokens that give sub-agents their own identities in the chat. When a swarm agent sends a message, it appears to come from a distinct bot (e.g., "ResearchBot", "CodeBot") rather than the main assistant.

## Prerequisites

- `src/channels/telegram.ts` must exist (from `/add-telegram`)
- `package.json` — must include `grammy` `^1.39.3` in dependencies (already present)

## Files to modify

| File | Action |
|------|--------|
| `src/channels/telegram.ts` | Add swarm bot pool support |

## Behavioral requirements

### Bot pool configuration

- **Env vars:** `TELEGRAM_POOL_TOKEN_1`, `TELEGRAM_POOL_TOKEN_2`, ..., `TELEGRAM_POOL_TOKEN_5`
  - Up to 5 additional bot tokens for the pool
  - Each is a standard BotFather token
- Pool bots are send-only — they don't poll for messages (only the main bot does)
- Create pool bot instances using Grammy's `Api` class (not `Bot`) to avoid polling:
  ```typescript
  import { Api } from 'grammy';
  const poolApi = new Api(token);
  ```

### Sender-to-bot assignment

- **Stable keying:** Map `{groupFolder}:{senderName}` → pool bot index
  - Same sender always gets the same bot in the same group
  - Use a simple hash: `hashCode(key) % poolSize`
- **Round-robin fallback:** If hash collides too much, cycle through available bots
- **Cache:** Store assignments in a `Map<string, Api>` for the session

### Per-bot naming

- When a pool bot is assigned to a sender name for the first time:
  1. Call `poolApi.setMyName(senderName)` to rename the bot
  2. Wait 2 seconds for Telegram to propagate the name change
  3. Then send the message
- Cache the current name per bot to avoid unnecessary renames
- Only rename if the new sender differs from the bot's current name

### MCP integration

- The `send_message` MCP tool already exists. Extend the Telegram channel's `sendMessage()`:
  - Accept an optional `sender` parameter (passed via MCP tool metadata or message prefix)
  - If `sender` is provided AND pool bots are configured:
    1. Look up or assign a pool bot for this sender
    2. Rename the pool bot if needed
    3. Send via the pool bot's `Api` instance
  - If no sender or no pool bots: send via the main bot as usual

### Message format

- Parse sender from the `send_message` text if it starts with `[SenderName]: `:
  ```typescript
  const senderMatch = text.match(/^\[([^\]]+)\]:\s*/);
  if (senderMatch) {
    sender = senderMatch[1];
    text = text.slice(senderMatch[0].length);
  }
  ```

### Graceful degradation

- If no pool tokens are configured, swarm messages fall back to the main bot
- If a pool bot's token is invalid, log warning and skip it
- If `setMyName()` fails, send the message anyway (name update is best-effort)

## Env vars

```
TELEGRAM_POOL_TOKEN_1=
TELEGRAM_POOL_TOKEN_2=
TELEGRAM_POOL_TOKEN_3=
TELEGRAM_POOL_TOKEN_4=
TELEGRAM_POOL_TOKEN_5=
```

## Verification

```bash
npx tsc --noEmit
npx vitest run src/channels/telegram.test.ts
```
