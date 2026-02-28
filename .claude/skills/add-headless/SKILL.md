---
disable-model-invocation: true
---

# /add-headless — Headless/API Channel

> **Note:** This skill is called automatically by `/setup` when the user selects Headless. You only need to run it individually if you want to generate the headless channel separately for customization.

Generates an HTTP API channel using `node:http` for programmatic access to the assistant without a messaging platform.

## Prerequisites

These files must exist:

- `src/types.ts` — must export `Channel`, `NewMessage`, `OnInboundMessage`, `OnChatMetadata`, `RegisteredGroup`
- `src/config.ts` — must export `config`
- `src/env.ts` — must export `env`
- `src/logger.ts` — must export `logger`
- `src/index.ts` — must exist (from `/add-orchestrator`)

No additional npm dependencies required — uses `node:http` only.

## Context

This is Layer 4 — a messaging channel. The headless channel exposes a simple HTTP API for external integrations, webhooks, scripts, and custom UIs. Read **`headless-protocol.md`** in this skill's directory for the full API specification.

## Files to create

| File | Purpose |
|------|---------|
| `src/channels/headless.ts` | Headless HTTP API channel implementation |
| `src/channels/headless.test.ts` | Unit tests |

## Interface contracts

The Headless channel implements a slightly extended `Channel` interface — it takes an additional `getGroups` callback in the factory:

```typescript
function createHeadlessChannel(
  onMessage: OnInboundMessage,
  onChatMetadata: OnChatMetadata,
  getGroups: () => RegisteredGroup[],
): Channel
```

The `Channel` interface itself:

```typescript
interface Channel {
  name: string;                                          // 'headless'
  connect(): Promise<void>;                              // Start HTTP server
  sendMessage(jid: string, text: string): Promise<void>; // Store response
  isConnected(): boolean;                                // Server listening
  ownsJid(jid: string): boolean;                         // Does this channel handle this JID?
  disconnect(): Promise<void>;                           // Stop HTTP server
  setTyping?(jid: string, isTyping: boolean): Promise<void>; // No-op
}
```

## Behavioral requirements

### src/channels/headless.ts

1. Export `createHeadlessChannel(onMessage, onChatMetadata, getGroups)` that returns a `Channel`.

2. **Connection:**
   - Create an HTTP server using `node:http`
   - Listen on `env.HEADLESS_PORT` (default: 3000)
   - Track connection state (server listening)
   - Log connection status changes

3. **JID format:**
   - JIDs use the format `hl:{channelId}` (e.g., `hl:default`)
   - `ownsJid(jid)` returns `true` for JIDs starting with `hl:`
   - Extract channel ID with `jid.slice(3)`

4. **Authentication:**
   - If `env.HEADLESS_SECRET` is set, require `Authorization: Bearer <secret>` header on all endpoints except `/health`
   - Return `401 Unauthorized` JSON response if auth fails
   - If `HEADLESS_SECRET` is not set, skip auth checks

5. **Route handling:**

   **POST /message:**
   - Parse JSON body: `{ content: string, sender_name?: string, channel_id?: string }`
   - Validate `content` is present and non-empty → 400 if missing
   - Validate `content.length <= 10000` → 413 if too large
   - Default `sender_name` to `"api"`, `channel_id` to `"default"`
   - Generate `request_id` via `crypto.randomUUID()`
   - Construct JID: `hl:${channel_id}`
   - Construct `NewMessage`:
     ```typescript
     {
       id: request_id,
       sender: sender_name,
       sender_name: sender_name,
       content: content,
       timestamp: new Date().toISOString(),
       is_from_me: false,
     }
     ```
   - Call `onMessage(jid, newMessage)`
   - Return `202 Accepted` with `{ status: "queued", request_id }`

   **GET /groups:**
   - Call `getGroups()` callback
   - Return `200 OK` with `{ groups: RegisteredGroup[] }`

   **GET /health:**
   - No authentication required
   - Return `200 OK` with `{ status: "ok" }`

   **Other routes:**
   - Return `404 Not Found` with `{ error: "not found" }`

6. **Response storage:**
   - `sendMessage(jid, text)` stores responses in an in-memory ring buffer
   - Buffer keyed by JID, capacity 100 per JID
   - Drop oldest on overflow
   - This is fire-and-forward — the HTTP response to POST /message is always immediate

7. **Typing indicator:**
   - `setTyping` is a no-op (HTTP has no equivalent)

8. **Disconnection:**
   - `disconnect()` — close the HTTP server cleanly
   - Log disconnection

9. **Request body parsing:**
   - Read request body as stream, parse as JSON
   - Handle malformed JSON with `400 Bad Request`
   - Limit body size to 64KB to prevent abuse

### src/channels/headless.test.ts

1. Test JID ownership: `hl:default` returns true; `dc:123` returns false
2. Test JID extraction: `hl:webhook-1` → channel ID `webhook-1`
3. Test POST /message: valid request → 202 with request_id, onMessage called
4. Test POST /message validation: missing content → 400
5. Test GET /health: returns `{ status: "ok" }` without auth
6. Test auth enforcement: request without Bearer token → 401 (when secret configured)
7. Test ring buffer: after 101 messages, oldest is dropped

## Integration with orchestrator

After creating the channel files, modify `src/index.ts` to:

1. Import `createHeadlessChannel` from `./channels/headless.js`
2. In the initialization section:
   ```typescript
   if (env.HEADLESS_PORT || env.HEADLESS_SECRET) {
     const headless = createHeadlessChannel(onMessage, onChatMetadata, () => router.getRegisteredGroups());
     await headless.connect();
     channels.push(headless);
   }
   ```

## Verification

```bash
# Type check
npx tsc --noEmit

# Unit tests
npx vitest run src/channels/headless.test.ts

# Manual smoke test
curl -X POST http://localhost:3000/message \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secret" \
  -d '{"content": "Hello!"}'

curl http://localhost:3000/health
```
