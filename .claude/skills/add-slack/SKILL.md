---
disable-model-invocation: true
---

# /add-slack — Slack Channel

> **Note:** This skill is called automatically by `/setup` when the user selects Slack. You only need to run it individually if you want to generate the Slack channel separately for customization.

Generates Slack integration using the @slack/bolt library (v3) in Socket Mode.

## Prerequisites

These files must exist:

- `src/types.ts` — must export `Channel`, `NewMessage`, `OnInboundMessage`, `OnChatMetadata`
- `src/config.ts` — must export `config`
- `src/env.ts` — must export `env`
- `src/logger.ts` — must export `logger`
- `src/index.ts` — must exist (from `/add-orchestrator`)
- `package.json` — must include `@slack/bolt` `^3.0.0` in dependencies

## Context

This is Layer 4 — a messaging channel. Slack integration uses the @slack/bolt library in Socket Mode, which requires both a bot token and an app-level token. Socket Mode avoids the need for a public URL/webhook.

## Files to create

| File | Purpose |
|------|---------|
| `src/channels/slack.ts` | Slack channel implementation |
| `src/channels/slack.test.ts` | Unit tests |

## Interface contracts

The Slack channel must implement the `Channel` interface:

```typescript
interface Channel {
  name: string;                                          // 'slack'
  connect(): Promise<void>;                              // Connect via Socket Mode
  sendMessage(jid: string, text: string): Promise<void>; // Send text message
  isConnected(): boolean;                                // Connection status
  ownsJid(jid: string): boolean;                         // Does this channel handle this JID?
  disconnect(): Promise<void>;                           // Clean disconnect
  setTyping?(jid: string, isTyping: boolean): Promise<void>; // Typing indicator (no-op)
}
```

## Behavioral requirements

### src/channels/slack.ts

1. Export `createSlackChannel(onMessage, onChatMetadata)` that returns a `Channel`:
   ```typescript
   function createSlackChannel(
     onMessage: OnInboundMessage,
     onChatMetadata: OnChatMetadata,
   ): Channel
   ```

2. **Connection and authentication:**
   - Use `App` from `@slack/bolt` with Socket Mode enabled
   - Requires `env.SLACK_BOT_TOKEN` (xoxb-...) and `env.SLACK_APP_TOKEN` (xapp-...)
   - `SLACK_APP_TOKEN` must have `connections:write` scope for Socket Mode
   - Track connection state manually (set on successful `app.start()`)
   - Log connection status changes

3. **JID format:**
   - JIDs use the format `slack:{channelId}` (e.g., `slack:C0123456789`)
   - `ownsJid(jid)` returns `true` for JIDs starting with `slack:`
   - Extract Slack channel ID with `jid.slice(6)`

4. **Inbound message handling:**
   - Register `app.message()` handler
   - Skip messages with `subtype === 'bot_message'` or `message.bot_id` present
   - For each new message:
     - Construct JID: `slack:${message.channel}`
     - Extract sender from `message.user`
     - Look up sender display name via `client.users.info()` (cache results)
     - Extract text content from `message.text`
     - Skip messages with empty text
     - Construct `NewMessage` object:
       ```typescript
       {
         id: message.ts,  // Slack uses timestamps as message IDs
         sender: message.user,
         sender_name: displayName,
         content: message.text,
         timestamp: new Date(parseFloat(message.ts) * 1000).toISOString(),
         is_from_me: false,  // Bot messages are already filtered
       }
       ```
     - Call `onMessage(jid, newMessage)`
   - Call `onChatMetadata` with channel info when available

5. **Outbound messages:**
   - `sendMessage(jid, text)` — use `app.client.chat.postMessage({ channel, text })`
   - Split messages at 3000 characters (Slack's effective limit for formatting)
   - Handle send failures gracefully (log error, don't crash)
   - `setTyping` is a no-op — Slack has no equivalent typing indicator API for bots

6. **User name cache:**
   - Cache `userId → displayName` mappings in a `Map`
   - Fetch from `client.users.info()` on first encounter
   - Cache entries don't expire (names rarely change during a session)

7. **Disconnection:**
   - `disconnect()` — call `app.stop()` cleanly
   - Log disconnection

### src/channels/slack.test.ts

1. Test JID ownership: `slack:C0123` returns true; `dc:123` returns false
2. Test JID extraction: `slack:C0123456789` → channel ID `C0123456789`
3. Test message splitting: message over 3000 chars splits correctly
4. Test bot message filtering: messages with `bot_id` or `subtype === 'bot_message'` are skipped
5. Test connection state tracking: verify `isConnected()` reflects app state

## Integration with orchestrator

After creating the channel files, modify `src/index.ts` to:

1. Import `createSlackChannel` from `./channels/slack.js`
2. In the initialization section:
   ```typescript
   if (env.SLACK_BOT_TOKEN && env.SLACK_APP_TOKEN) {
     const slack = createSlackChannel(onMessage, onChatMetadata);
     await slack.connect();
     channels.push(slack);
   }
   ```

## Key @slack/bolt patterns

```typescript
import { App } from '@slack/bolt';

const app = new App({
  token: env.SLACK_BOT_TOKEN,
  appToken: env.SLACK_APP_TOKEN,
  socketMode: true,
});

app.message(async ({ message, client }) => {
  if ('subtype' in message && message.subtype === 'bot_message') return;
  if ('bot_id' in message) return;
  // process message
});

await app.start();
```

## Verification

```bash
# Type check
npx tsc --noEmit

# Unit tests
npx vitest run src/channels/slack.test.ts
```
