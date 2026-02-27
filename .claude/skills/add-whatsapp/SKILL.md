---
disable-model-invocation: true
---

# /add-whatsapp — WhatsApp Channel

> **Note:** This skill is called automatically by `/setup` when the user selects WhatsApp. You only need to run it individually if you want to generate the WhatsApp channel separately for customization.

Generates WhatsApp integration using the Baileys library (v7).

## Prerequisites

These files must exist:

- `src/types.ts` — must export `Channel`, `NewMessage`, `OnInboundMessage`, `OnChatMetadata`
- `src/config.ts` — must export `config`
- `src/env.ts` — must export `env`
- `src/logger.ts` — must export `logger`
- `src/index.ts` — must exist (from `/add-orchestrator`)
- `package.json` — must include `@whiskeysockets/baileys` `^7.0.0-rc.9` in dependencies

## Context

This is Layer 4 — the first messaging channel. WhatsApp integration uses the Baileys library v7, which provides an unofficial WhatsApp Web API. Authentication supports both QR code scanning and pairing code entry. Session persistence across restarts.

## Files to create

| File | Purpose |
|------|---------|
| `src/channels/whatsapp.ts` | WhatsApp channel implementation |
| `src/channels/whatsapp-auth.ts` | Standalone auth utility for initial pairing |
| `src/channels/whatsapp.test.ts` | Unit tests |

## Interface contracts

The WhatsApp channel must implement the `Channel` interface:

```typescript
interface Channel {
  name: string;                                          // 'whatsapp'
  connect(): Promise<void>;                              // Connect and authenticate
  sendMessage(jid: string, text: string): Promise<void>; // Send text message
  isConnected(): boolean;                                // Connection status
  ownsJid(jid: string): boolean;                         // Does this channel handle this JID?
  disconnect(): Promise<void>;                           // Clean disconnect
  setTyping?(jid: string, isTyping: boolean): Promise<void>; // Typing indicator
}
```

## Behavioral requirements

### src/channels/whatsapp.ts

1. Export `createWhatsAppChannel(onMessage, onChatMetadata)` that returns a `Channel`:
   ```typescript
   function createWhatsAppChannel(
     onMessage: OnInboundMessage,
     onChatMetadata: OnChatMetadata,
   ): Channel
   ```

2. **Connection and authentication (Baileys v7):**
   - Use `makeWASocket` from Baileys with `useMultiFileAuthState` for session persistence
   - Store auth state in `${STORE_DIR}/auth_info/` directory
   - **Pairing code authentication:**
     - If no stored session exists, prompt user for their phone number
     - Request pairing code via `sock.requestPairingCode(phoneNumber)`
     - Display the pairing code for the user to enter on their phone (WhatsApp > Linked Devices > Link with Phone Number)
   - **QR code fallback:**
     - If pairing code fails, fall back to QR code display via `qrcode-terminal`
   - On subsequent connections: reuse stored auth state (no auth needed)
   - Handle connection close events and auto-reconnect with exponential backoff
   - Log connection status changes

3. **LID-to-phone JID translation (Baileys v7):**
   - Baileys v7 uses Linked Identity (LID) JIDs internally (`{lid}@lid`)
   - Translate LID JIDs to phone JIDs for consistent storage and lookup
   - Use `sock.user.id` to get the bot's own phone JID
   - Normalize JIDs: strip `:device` suffix, handle `@s.whatsapp.net` and `@g.us`

4. **Group metadata sync cache:**
   - Fetch and cache group metadata (participants, subject) on connection
   - Refresh cache every 24 hours
   - Use cached metadata for sender name resolution in groups
   - `sock.groupFetchAllParticipating()` for initial sync

5. **Inbound message handling:**
   - Listen for `messages.upsert` events
   - For each new message:
     - Extract JID, sender, sender name (push name or phone number), content, timestamp
     - Translate LID JIDs to phone JIDs
     - Determine `is_from_me` from message key
     - Construct `NewMessage` object
     - Call `onMessage(chatJid, message)`
   - For group messages: extract group JID and participant info from cache
   - Ignore protocol messages, reactions, and media-only messages (no text content)
   - Call `onChatMetadata` for chat/group metadata updates

6. **Outbound messages with queue:**
   - `sendMessage(jid, text)` — send text message via Baileys `sendMessage`
   - **Outbound message queue during disconnect:**
     - If socket is not connected, queue messages
     - On reconnection, flush the queue in order
     - Maximum queue size: 100 messages (drop oldest on overflow)
   - Handle message send failures gracefully (log error, don't crash)
   - Implement `setTyping` using Baileys presence updates (`composing`/`paused`)

7. **JID handling:**
   - `ownsJid(jid)` returns `true` for JIDs ending in `@s.whatsapp.net` or `@g.us`
   - Normalize JIDs (strip device suffix if present)

8. **Disconnection:**
   - `disconnect()` — close the WebSocket connection cleanly
   - Cancel any pending reconnect timers
   - Log disconnection

### src/channels/whatsapp-auth.ts

Standalone auth utility that can be run independently to complete initial WhatsApp pairing without starting the full application:

1. Export `runWhatsAppAuth()` — async function that:
   - Creates a Baileys socket with `useMultiFileAuthState`
   - Prompts for phone number
   - Requests pairing code
   - Waits for successful connection
   - Saves credentials and exits
2. Can be run via: `npx tsx src/channels/whatsapp-auth.ts`
3. Useful for headless setup or CI environments

### src/channels/whatsapp.test.ts

1. Test JID ownership: `@s.whatsapp.net` and `@g.us` return true; `@telegram` returns false
2. Test JID normalization: strip device suffix
3. Test outbound queue: messages queued when disconnected
4. Test message extraction: mock Baileys message event → verify NewMessage fields
5. Test connection state tracking: verify `isConnected()` reflects socket state

## Integration with orchestrator

After creating the channel files, modify `src/index.ts` to:

1. Import `createWhatsAppChannel` from `./channels/whatsapp.js`
2. In the initialization section, create the WhatsApp channel:
   ```typescript
   if (!env.TELEGRAM_ONLY) {
     const whatsapp = createWhatsAppChannel(onMessage, onChatMetadata);
     await whatsapp.connect();
     channels.push(whatsapp);
   }
   ```
3. The `onMessage` callback should call `db.storeMessage()` and the `onChatMetadata` callback should call `db.storeChatMetadata()`

## Key Baileys v7 patterns

These patterns ensure correct usage of Baileys v7:

```typescript
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';

// Auth state persistence
const { state, saveCreds } = await useMultiFileAuthState(authDir);

// Socket creation (v7 patterns)
const sock = makeWASocket({
  auth: {
    creds: state.creds,
    keys: makeCacheableSignalKeyStore(state.keys, logger),
  },
  printQRInTerminal: false,  // We handle QR/pairing display ourselves
  logger: pinoLogger,        // Pass pino logger for internal logging
});

// Save credentials on update
sock.ev.on('creds.update', saveCreds);

// Pairing code auth (v7)
if (!state.creds.registered) {
  const code = await sock.requestPairingCode(phoneNumber);
  console.log(`Pairing code: ${code}`);
}

// Connection updates
sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
  if (qr) { /* display QR as fallback */ }
  if (connection === 'close') { /* handle reconnect */ }
  if (connection === 'open') { /* connected */ }
});

// Message events
sock.ev.on('messages.upsert', ({ messages, type }) => {
  if (type !== 'notify') return;
  for (const msg of messages) { /* process */ }
});

// Group metadata cache
const groups = await sock.groupFetchAllParticipating();
```

## Verification

```bash
# Type check
npx tsc --noEmit

# Unit tests
npx vitest run src/channels/whatsapp.test.ts

# Auth test (standalone)
npx tsx src/channels/whatsapp-auth.ts
```
