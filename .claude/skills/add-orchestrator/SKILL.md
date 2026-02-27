---
disable-model-invocation: true
---

# /add-orchestrator — Main Loop

> **Note:** This skill is called automatically by `/setup`. You only need to run it individually if you want to generate the orchestrator separately for customization.

Generates the main entry point that wires all modules together into the polling orchestrator.

## Prerequisites

These files must exist:

- `src/types.ts` — all interfaces including `ContainerInput` (from `/add-core`)
- `src/config.ts`, `src/env.ts`, `src/logger.ts` — configuration (from `/add-core`)
- `src/db.ts`, `src/router.ts` — database and routing (from `/add-core`)
- `src/group-folder.ts` — group folder validation (from `/add-core`)
- `src/container.ts`, `src/container-runtime.ts`, `src/ipc.ts` — container execution (from `/add-containers`)
- `src/scheduler.ts`, `src/group-queue.ts` — scheduling (from `/add-scheduler`)

At least one channel module must exist before the system can actually run, but the orchestrator should compile without channels (they're dynamically loaded).

## Context

This is Layer 3 — the main orchestrator that ties everything together. It implements the polling loop, message processing pipeline, trigger detection, and graceful shutdown. Read **`state-machine.md`** in this skill's directory for the full state machine specification.

## Files to create

| File | Purpose |
|------|---------|
| `src/index.ts` | Main entry point: init, polling loop, shutdown |
| `src/message-processor.ts` | Message processing pipeline: trigger detection, XML context building |
| `src/message-processor.test.ts` | Unit tests for message processor |

## Interface contracts

The orchestrator uses these types:

```typescript
// From src/types.ts
import type { Channel, NewMessage, RegisteredGroup, ContainerInput, AppState, OnInboundMessage, OnChatMetadata } from './types.js';

// Channel registration
interface ChannelRegistration {
  channel: Channel;
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
}
```

## Behavioral requirements

### src/message-processor.ts

1. Export `createMessageProcessor(config)` with:
   - `shouldTrigger(message: NewMessage, group: RegisteredGroup)` — returns true if message matches trigger pattern
   - `buildContext(db, chatJid, since)` — collects messages since last processing into XML format
   - `formatPrompt(context, triggerMessage, group)` — builds the prompt sent to the container agent
   - `stripInternalTags(text: string)` — removes `<internal>...</internal>` from outbound messages
2. Trigger detection:
   - Uses regex: `new RegExp(`@${group.trigger}`, 'i')` where trigger defaults to `'Andy'`
   - Main group: always triggers (every message)
   - Non-main groups with `requiresTrigger !== false`: only trigger on pattern match
   - Non-main groups accumulate messages as context until trigger
3. Context building — **XML format**:
   ```xml
   <messages>
   <message sender="Alice" time="2024-01-23T12:00:00.000Z">Hello!</message>
   <message sender="Bob" time="2024-01-23T12:01:00.000Z">Hi there!</message>
   </messages>
   ```
   - Fetch messages from DB since last-processed timestamp
   - Format as XML with sender and timestamp attributes
   - Escape XML special characters in content
4. Internal tag stripping:
   - `stripInternalTags(text)` removes `<internal>...</internal>` blocks from agent output
   - Prevents internal reasoning from being sent to users
5. Bot message detection:
   - Beyond the `is_bot_message` DB flag, also check content prefix as backstop
   - If message content starts with `[${assistantName}]:` or similar bot prefix patterns, treat as bot message

### src/index.ts

1. Main flow (see `state-machine.md` for the full state machine):
   - **Init**: Load env, init DB, create router, cleanup orphan containers, build container image, start IPC watcher, start scheduler, register channels
   - **Poll loop**: Every `POLL_INTERVAL` (2000ms), check all channels for new messages
   - **Process**: For each group with new messages, determine if trigger is met, then enqueue container execution via group queue
   - **Execute**: Build `ContainerInput` object, run container, parse streaming sentinel outputs, send responses via the originating channel
   - **Shutdown**: On SIGTERM/SIGINT, stop polling, stop scheduler, stop IPC watcher, close active container sessions, disconnect channels, close DB

2. **ContainerInput construction** (not plain text prompts):
   ```typescript
   const containerInput: ContainerInput = {
     prompt: formattedPrompt,
     sessionId: sessionId ?? crypto.randomUUID(),
     groupFolder: group.folder,
     chatJid: chatJid,
     isMain: router.isMainGroup(group.folder),
     isScheduledTask: false,
     assistantName: env.ASSISTANT_NAME,
     secrets: {
       ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY ?? '',
     },
   };
   ```

3. **Pre-run data preparation**:
   - Write `current_tasks.json` to `ipc/${groupFolder}/` before container runs
   - Write `available_groups.json` to `ipc/${groupFolder}/` for main group containers
   - Write Claude settings to `data/sessions/${groupFolder}/.claude/settings.json`

4. **Multi-turn message delivery**:
   - When a message arrives for a group with a running container → write to `ipc/${groupFolder}/input/` via `writeFollowUpMessage()`
   - Track active containers per group to know when to route to IPC vs queue new container

5. **Streaming output delivery**:
   - Wire `onOutput` callback to `channel.sendMessage` for streaming delivery
   - Each sentinel-marked output block is sent as it arrives (don't wait for container exit)
   - Strip `<internal>...</internal>` tags from outbound messages

6. **Cursor rollback**:
   - Advance `lastProcessed` before processing (optimistic)
   - Roll back on error UNLESS output was already sent to the channel
   - This prevents message loss on container crashes

7. Channel registration:
   - Import channels dynamically based on configuration
   - Each channel provides `connect()`, `sendMessage()`, `isConnected()`, `ownsJid()`, `disconnect()`
   - Route inbound messages through `OnInboundMessage` callback which stores in DB
   - Route chat metadata through `OnChatMetadata` callback which updates DB

8. Message polling pipeline:
   - For each registered group, query new messages since last-processed timestamp
   - Deduplicate by group (batch all new messages together)
   - Check trigger conditions via message processor
   - If triggered: enqueue container execution in group queue
   - Update last-processed timestamp after successful processing

9. IPC integration:
   - Wire IPC handlers to scheduler functions:
     - `onScheduleTask` → `createTask`
     - `onPauseTask` → `pauseTask`
     - `onResumeTask` → `resumeTask`
     - `onCancelTask` → `cancelTask`
     - `onRefreshGroups` → `router.loadState()`
     - `onRegisterGroup` → `router.registerGroup()`

10. Crash recovery:
    - On startup, scan registered groups for unprocessed messages (messages after last-processed timestamp)
    - Process any backlog before entering the normal polling loop

11. Graceful shutdown:
    - Listen for SIGTERM and SIGINT
    - Stop all polling loops (message poll, scheduler, IPC watcher)
    - Signal active containers to close via `writeCloseSentinel()`
    - Wait for in-flight container executions to complete (with timeout)
    - Disconnect all channels
    - Close database
    - Exit with code 0

### src/message-processor.test.ts

1. Test `shouldTrigger`:
   - Main group → always true
   - Non-main with trigger → regex match
   - Non-main without trigger → always true
2. Test `buildContext`:
   - Returns XML format with sender and timestamp attributes
   - Properly escapes XML special characters
3. Test `stripInternalTags`:
   - Removes `<internal>...</internal>` blocks
   - Preserves non-internal content
   - Handles nested/multiple internal blocks

## Integration points

| Import | From |
|--------|------|
| `initDb`, query functions | `./db.js` |
| `createRouter` | `./router.js` |
| `runContainer`, `parseContainerOutput`, `parseAllOutputs`, `buildImage`, `cleanupOrphans`, `writePreRunData`, `writeClaudeSettings` | `./container.js` |
| `createIpcWatcher`, `writeFollowUpMessage`, `writeCloseSentinel` | `./ipc.js` |
| `createScheduler`, task functions | `./scheduler.js` |
| `createGroupQueue` | `./group-queue.js` |
| `createMessageProcessor` | `./message-processor.js` |
| Channel modules | `./channels/*.js` (dynamic) |

## Verification

```bash
# Type check — the most important verification
npx tsc --noEmit

# Unit tests
npx vitest run src/message-processor.test.ts

# The orchestrator is primarily an integration module.
# Full verification happens in /setup and /test.
```
