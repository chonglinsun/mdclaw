---
disable-model-invocation: true
---

# /add-voice-transcription — WhatsApp Voice Message Transcription

Adds OpenAI Whisper transcription for WhatsApp voice messages. When a voice message arrives, it is downloaded, transcribed, and the transcription is stored as the message content.

## Prerequisites

- `src/channels/whatsapp.ts` must exist (from `/add-whatsapp`)
- `package.json` — must include `openai` `^4.0.0` in dependencies

## Files to modify

| File | Action |
|------|--------|
| `src/channels/whatsapp.ts` | Add voice message handling |

## Behavioral requirements

### Modifications to src/channels/whatsapp.ts

1. **Voice message detection:**
   - In the `messages.upsert` handler, check for `message.message?.audioMessage` with `ptt: true` (push-to-talk = voice note)
   - Also detect `message.message?.documentMessage` with audio MIME types

2. **Audio download:**
   - Use Baileys' `downloadMediaMessage(message)` to get the audio buffer
   - Write to a temp file with appropriate extension (`.ogg` for voice notes)

3. **Whisper transcription:**
   - If `env.WHISPER_API_KEY` is set, call OpenAI Whisper API:
     ```typescript
     const openai = new OpenAI({ apiKey: env.WHISPER_API_KEY });
     const transcription = await openai.audio.transcriptions.create({
       file: fs.createReadStream(tempFile),
       model: 'whisper-1',
     });
     ```
   - Use the transcription text as the message content
   - Prefix with `[Voice message transcription]: ` for clarity

4. **Fallback:**
   - If `WHISPER_API_KEY` is not set, store `[Voice message — transcription unavailable]` as content
   - If transcription fails, log error and store `[Voice message — transcription failed]`

5. **Cleanup:**
   - Delete temp audio file after transcription (success or failure)

## Env vars

```
WHISPER_API_KEY=             # OpenAI API key for Whisper transcription
```

## Verification

```bash
npx tsc --noEmit
npx vitest run src/channels/whatsapp.test.ts
```
