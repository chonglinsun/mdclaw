---
disable-model-invocation: true
---

# /add-gmail — Gmail/Email Channel

Generates Gmail integration that can operate as a full channel (receive and send emails) or as an MCP-only tool (send emails from any channel's container).

## Prerequisites

- `src/types.ts`, `src/config.ts`, `src/env.ts`, `src/logger.ts`, `src/index.ts`
- `package.json` — must include `googleapis` `^144.0.0` in dependencies

## Files to create

| File | Purpose |
|------|---------|
| `src/channels/gmail.ts` | Gmail channel implementation |
| `src/channels/gmail.test.ts` | Unit tests |

## Behavioral requirements

### src/channels/gmail.ts

1. Export `createGmailChannel(onMessage, onChatMetadata)` that returns a `Channel`.

2. **Authentication:**
   - OAuth2 via `googleapis` (`google.auth.OAuth2`)
   - Credentials from `env.GMAIL_CLIENT_ID`, `env.GMAIL_CLIENT_SECRET`, `env.GMAIL_REFRESH_TOKEN`
   - Token refresh handled automatically by the OAuth2 client

3. **JID format:**
   - `gmail:{emailAddress}` (e.g., `gmail:user@gmail.com`)
   - `ownsJid(jid)` returns `true` for JIDs starting with `gmail:`

4. **Inbound (channel mode):**
   - Poll Gmail API for new messages every `POLL_INTERVAL` using `users.messages.list` with `q: 'is:unread'`
   - Mark processed messages as read via `users.messages.modify` (remove UNREAD label)
   - Extract sender, subject, body (prefer plain text part)
   - Construct `NewMessage` with `id: messageId`, `sender: fromAddress`, `content: "Subject: {subject}\n\n{body}"`
   - Skip messages from self (check against authenticated user's email)

5. **Outbound:**
   - `sendMessage(jid, text)` — compose and send via `users.messages.send`
   - RFC 2822 MIME format: `To`, `Subject` (from first line or "Re: ..."), `Content-Type: text/plain`
   - Reply threading: if responding to an inbound message, set `In-Reply-To` and `References` headers, use same `threadId`

6. **MCP-only mode:**
   - If `env.GMAIL_MODE === 'tool'`, do NOT poll for inbound messages
   - Only expose send capability (used by containers as an MCP tool for sending emails from any channel)
   - The MCP server in agent-runner can call `send_message` with a `gmail:` JID to send email

7. **Voice message support (optional):**
   - If `env.WHISPER_API_KEY` is set and an email has audio attachments, transcribe via OpenAI Whisper API
   - Append transcription to message content

### src/channels/gmail.test.ts

1. Test JID ownership: `gmail:user@gmail.com` → true; `dc:123` → false
2. Test MIME message construction
3. Test inbound message parsing (plain text extraction)
4. Test MCP-only mode skips polling

## Env vars

```
GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
GMAIL_REFRESH_TOKEN=
GMAIL_MODE=channel          # 'channel' (full) or 'tool' (send-only)
```

## Integration with orchestrator

```typescript
if (env.GMAIL_CLIENT_ID && env.GMAIL_MODE !== 'tool') {
  const gmail = createGmailChannel(onMessage, onChatMetadata);
  await gmail.connect();
  channels.push(gmail);
}
```

## Verification

```bash
npx tsc --noEmit
npx vitest run src/channels/gmail.test.ts
```
