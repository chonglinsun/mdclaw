---
disable-model-invocation: true
---

# /add-discord — Discord Channel

> **Note:** This skill is called automatically by `/setup` when the user selects Discord. You only need to run it individually if you want to generate the Discord channel separately for customization.

Generates Discord integration using the discord.js library (v14).

## Prerequisites

These files must exist:

- `src/types.ts` — must export `Channel`, `NewMessage`, `OnInboundMessage`, `OnChatMetadata`
- `src/config.ts` — must export `config`
- `src/env.ts` — must export `env`
- `src/logger.ts` — must export `logger`
- `src/index.ts` — must exist (from `/add-orchestrator`)
- `package.json` — must include `discord.js` `^14.0.0` in dependencies

## Context

This is Layer 4 — a messaging channel. Discord integration uses the discord.js library v14 with bot token authentication. The bot listens for messages in all channels it has access to and responds when triggered.

## Files to create

| File | Purpose |
|------|---------|
| `src/channels/discord.ts` | Discord channel implementation |
| `src/channels/discord.test.ts` | Unit tests |

## Interface contracts

The Discord channel must implement the `Channel` interface:

```typescript
interface Channel {
  name: string;                                          // 'discord'
  connect(): Promise<void>;                              // Connect and authenticate
  sendMessage(jid: string, text: string): Promise<void>; // Send text message
  isConnected(): boolean;                                // Connection status
  ownsJid(jid: string): boolean;                         // Does this channel handle this JID?
  disconnect(): Promise<void>;                           // Clean disconnect
  setTyping?(jid: string, isTyping: boolean): Promise<void>; // Typing indicator
}
```

## Behavioral requirements

### src/channels/discord.ts

1. Export `createDiscordChannel(onMessage, onChatMetadata)` that returns a `Channel`:
   ```typescript
   function createDiscordChannel(
     onMessage: OnInboundMessage,
     onChatMetadata: OnChatMetadata,
   ): Channel
   ```

2. **Connection and authentication:**
   - Use `Client` from discord.js with `GatewayIntentBits.Guilds`, `GatewayIntentBits.GuildMessages`, `GatewayIntentBits.MessageContent`
   - Authenticate with `env.DISCORD_BOT_TOKEN`
   - Track connection state via `client.isReady()`
   - Log connection status changes

3. **JID format:**
   - JIDs use the format `dc:{channelId}` (e.g., `dc:1234567890`)
   - `ownsJid(jid)` returns `true` for JIDs starting with `dc:`
   - Extract Discord channel ID with `jid.slice(3)`

4. **Inbound message handling:**
   - Listen for `Events.MessageCreate` events
   - Skip messages where `message.author.bot === true`
   - For each new message:
     - Construct JID: `dc:${message.channelId}`
     - Extract sender name from `message.author.displayName` or `message.author.username`
     - Extract text content from `message.content`
     - For messages with attachments: append `[Attachment: {filename} ({contentType})]` to content
     - For replies: prepend `[Reply to {referencedMessage.author.username}: "{snippet}"]` to content (first 100 chars of referenced message)
     - Skip messages with no text content AND no processable attachments
     - Construct `NewMessage` object:
       ```typescript
       {
         id: message.id,
         sender: message.author.id,
         sender_name: displayName,
         content: message.content,
         timestamp: message.createdAt.toISOString(),
         is_from_me: message.author.id === client.user?.id,
       }
       ```
     - Call `onMessage(jid, newMessage)`
   - Call `onChatMetadata` with guild/channel info when available

5. **Outbound messages:**
   - `sendMessage(jid, text)` — fetch the Discord channel by ID, send text
   - Split messages at 2000 characters (Discord limit)
   - Handle send failures gracefully (log error, don't crash)
   - Implement `setTyping` using `channel.sendTyping()`

6. **Disconnection:**
   - `disconnect()` — call `client.destroy()` cleanly
   - Log disconnection

### src/channels/discord.test.ts

1. Test JID ownership: `dc:123` returns true; `@s.whatsapp.net` returns false
2. Test JID extraction: `dc:123456` → channel ID `123456`
3. Test message splitting: message over 2000 chars splits correctly
4. Test bot message filtering: messages with `author.bot === true` are skipped
5. Test connection state tracking: verify `isConnected()` reflects client state

## Integration with orchestrator

After creating the channel files, modify `src/index.ts` to:

1. Import `createDiscordChannel` from `./channels/discord.js`
2. In the initialization section:
   ```typescript
   if (env.DISCORD_BOT_TOKEN) {
     const discord = createDiscordChannel(onMessage, onChatMetadata);
     await discord.connect();
     channels.push(discord);
   }
   ```

## Key discord.js patterns

```typescript
import { Client, Events, GatewayIntentBits } from 'discord.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, (readyClient) => {
  logger.info({ user: readyClient.user.tag }, 'Discord bot connected');
});

client.on(Events.MessageCreate, (message) => {
  if (message.author.bot) return;
  // process message
});

await client.login(token);
```

## Verification

```bash
# Type check
npx tsc --noEmit

# Unit tests
npx vitest run src/channels/discord.test.ts
```
