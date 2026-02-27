---
disable-model-invocation: true
---

# /add-telegram — Telegram Channel (Optional)

> **Note:** This skill is called automatically by `/setup` when the user selects Telegram. You only need to run it individually if you want to generate the Telegram channel separately for customization.

Generates Telegram bot integration using the Grammy library.

## Prerequisites

These files must exist:

- `src/types.ts` — must export `Channel`, `NewMessage`, `OnInboundMessage`, `OnChatMetadata`
- `src/config.ts` — must export `config`
- `src/env.ts` — must export `env` (must include `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ONLY`)
- `src/logger.ts` — must export `logger`
- `src/index.ts` — must exist (from `/add-orchestrator`)
- `package.json` — must include `grammy` in dependencies

## Context

This is Layer 4 (optional) — Telegram as an alternative or additional messaging channel. Uses the Grammy library for Telegram Bot API integration. Requires a bot token from @BotFather.

## Files to create

| File | Purpose |
|------|---------|
| `src/channels/telegram.ts` | Telegram channel implementation |
| `src/channels/telegram.test.ts` | Unit tests |

## Interface contracts

The Telegram channel must implement the `Channel` interface:

```typescript
interface Channel {
  name: string;                                          // 'telegram'
  connect(): Promise<void>;                              // Start bot polling
  sendMessage(jid: string, text: string): Promise<void>; // Send text message
  isConnected(): boolean;                                // Bot running status
  ownsJid(jid: string): boolean;                         // Does this channel handle this JID?
  disconnect(): Promise<void>;                           // Stop bot
  setTyping?(jid: string, isTyping: boolean): Promise<void>; // Send chat action
}
```

## Behavioral requirements

### src/channels/telegram.ts

1. Export `createTelegramChannel(onMessage, onChatMetadata)` that returns a `Channel`:
   ```typescript
   function createTelegramChannel(
     onMessage: OnInboundMessage,
     onChatMetadata: OnChatMetadata,
   ): Channel
   ```

2. **Connection:**
   - Create Grammy `Bot` instance with `TELEGRAM_BOT_TOKEN` from env
   - Start long polling via `bot.start()`
   - Set bot commands via `bot.api.setMyCommands()` (optional: `/start`, `/help`)
   - Log bot username on successful connection

3. **Inbound message handling:**
   - Listen for text messages via `bot.on('message:text')`
   - For each message:
     - Extract chat ID (use `tg:${chatId}` as JID format to distinguish from WhatsApp)
     - Extract sender info: user ID, first name + last name as sender_name
     - Extract message text content
     - Construct `NewMessage` with `id: tg:${message.message_id}`
     - Call `onMessage(chatJid, message)`
   - For group chats: extract group title as chat name
   - Call `onChatMetadata` with chat info (channel: `'telegram'`, isGroup based on chat type)
   - Ignore non-text messages (photos, stickers, etc.) unless they have captions

4. **Outbound messages:**
   - `sendMessage(jid, text)` — extract numeric chat ID from JID format, send via `bot.api.sendMessage(chatId, text)`
   - Support long messages: if text > 4096 chars, split into multiple messages
   - Handle Telegram API errors gracefully (rate limits, chat not found)
   - `setTyping` — send `sendChatAction(chatId, 'typing')`

5. **JID handling:**
   - Use `tg:${chatId}` format (e.g., `tg:123456789`, `tg:-100123456789` for groups)
   - `ownsJid(jid)` returns `true` for JIDs starting with `tg:`
   - Extract numeric chat ID: `parseInt(jid.replace('tg:', ''))`

6. **Disconnection:**
   - `disconnect()` — call `bot.stop()` to cleanly shut down long polling
   - Log disconnection

### src/channels/telegram.test.ts

1. Test JID ownership: `tg:123` returns true; `abc@s.whatsapp.net` returns false
2. Test JID parsing: `tg:-100123456` → chat ID `-100123456`
3. Test message length splitting: text > 4096 chars → multiple chunks
4. Test message construction from mock Grammy context

## Integration with orchestrator

After creating the channel files, modify `src/index.ts` to:

1. Import `createTelegramChannel` from `./channels/telegram.js`
2. Conditionally create the Telegram channel if `env.TELEGRAM_BOT_TOKEN` is set:
   ```typescript
   if (env.TELEGRAM_BOT_TOKEN) {
     const telegram = createTelegramChannel(onMessage, onChatMetadata);
     await telegram.connect();
     channels.push(telegram);
   }
   ```
3. If `env.TELEGRAM_ONLY` is true, skip WhatsApp channel registration

## Key Grammy patterns

These patterns ensure correct usage of the Grammy library:

```typescript
import { Bot, Context } from 'grammy';

// Bot creation
const bot = new Bot(token);

// Message handling
bot.on('message:text', (ctx: Context) => {
  const chatId = ctx.chat.id;
  const text = ctx.message.text;
  const sender = ctx.from;
  // ...
});

// Send message
await bot.api.sendMessage(chatId, text);

// Typing indicator
await bot.api.sendChatAction(chatId, 'typing');

// Start polling (non-blocking)
bot.start({
  onStart: (botInfo) => logger.info(`Telegram bot @${botInfo.username} started`),
});

// Stop
bot.stop();
```

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes (for Telegram) | — | Bot token from @BotFather |
| `TELEGRAM_ONLY` | No | `false` | If true, only use Telegram (skip WhatsApp) |

## Verification

```bash
# Type check
npx tsc --noEmit

# Unit tests
npx vitest run src/channels/telegram.test.ts
```
