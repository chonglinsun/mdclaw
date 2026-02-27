# Orchestrator State Machine

## States

```
INITIALIZING → RECOVERING → POLLING → PROCESSING → EXECUTING → POLLING
                                                        ↓
                                                   SHUTTING_DOWN → STOPPED
```

### INITIALIZING

Entry point. Runs once at startup.

**Actions:**
1. Load environment variables (`env.ts`)
2. Initialize database (`initDb()`)
3. Create router (`createRouter(db)`) and load state
4. Cleanup orphan containers (`cleanupOrphans()`)
5. Build container image (`buildImage()`) — from `container/Dockerfile`
6. Create group queue (`createGroupQueue()`)
7. Create message processor (`createMessageProcessor()`)
8. Create and start IPC watcher (`createIpcWatcher()`)
9. Create and start scheduler (`createScheduler()`)
10. Create `data/global/CLAUDE.md` if it doesn't exist
11. Register signal handlers (SIGTERM, SIGINT → SHUTTING_DOWN)
12. Connect all configured channels

**Transitions:**
- Success → RECOVERING
- Any error → log and exit(1)

### RECOVERING

Runs once after initialization. Checks for unprocessed messages from before the last shutdown.

**Actions:**
1. For each registered group:
   - Get `lastProcessed` timestamp from router
   - Query messages since that timestamp
   - If messages exist, enqueue processing via group queue

**Transitions:**
- Done → POLLING

### POLLING

Steady state. Runs every `POLL_INTERVAL` (2000ms).

**Actions:**
1. For each connected channel:
   - For each registered group owned by this channel:
     - Query new messages since `lastProcessed`
     - If no new messages → continue
     - If group has active container → route to IPC input (multi-turn)
     - If new messages and no active container → transition to PROCESSING

**Transitions:**
- New messages found (no active container) → PROCESSING (per-group, concurrent)
- New messages found (active container) → write to IPC input, stay POLLING
- No messages → sleep POLL_INTERVAL → POLLING
- SIGTERM/SIGINT → SHUTTING_DOWN

### PROCESSING

Per-group state. Determines whether to execute a container.

**Actions:**
1. Fetch all new messages for the group
2. Check trigger condition:
   - Main group: always triggered
   - Non-main, `requiresTrigger`: check for `@trigger` pattern in any new message
3. If not triggered:
   - Update `lastProcessed` to latest message timestamp
   - Return to POLLING
4. If triggered:
   - Build XML context from accumulated messages
   - Format prompt
   - Enqueue in group queue → EXECUTING

**Transitions:**
- Not triggered → update cursor → POLLING
- Triggered → EXECUTING

### EXECUTING

Per-group state. Runs a container and sends the response.

**Actions:**
1. Get or create session ID for the group
2. Build `ContainerInput` object with prompt, session, secrets
3. Write pre-run data (`current_tasks.json`, `available_groups.json`)
4. Write Claude settings for the group
5. Advance `lastProcessed` cursor (optimistic)
6. Run container: `runContainer(groupFolder, containerInput, containerConfig)`
7. Stream output: each sentinel-marked block → `stripInternalTags()` → `channel.sendMessage()`
8. Store bot messages in DB
9. On error: roll back `lastProcessed` UNLESS output was already sent
10. Process any IPC commands generated during execution

**Transitions:**
- Complete → POLLING
- Container timeout → log, POLLING
- SIGTERM during execution → signal container to close, finish, then SHUTTING_DOWN

### SHUTTING_DOWN

Graceful shutdown sequence.

**Actions:**
1. Stop message polling loop
2. Stop scheduler polling loop
3. Stop IPC watcher
4. Signal active containers to close via `writeCloseSentinel()`
5. Wait for in-flight container executions (max 30s timeout)
6. Kill any remaining containers
7. Disconnect all channels
8. Close database connection
9. Log shutdown complete

**Transitions:**
- All cleanup done → STOPPED (exit 0)
- Timeout waiting for containers → force kill → STOPPED (exit 0)
- Second SIGTERM → immediate exit(1)

## Concurrency model

```
Main thread (single):
├── Poll timer (setInterval, POLL_INTERVAL)
├── Scheduler timer (setInterval, SCHEDULER_POLL_INTERVAL)
├── IPC watcher timer (setInterval, IPC_POLL_INTERVAL)
└── Group queue (manages async container executions)
    ├── Group A: [task1] → [task2] → ...  (sequential per group)
    ├── Group B: [task1] → ...
    └── Max 5 concurrent across all groups
```

- Single Node.js process, single thread (no workers)
- All I/O is async (container execution, channel communication)
- Database operations are synchronous (better-sqlite3) — fast, no blocking concern
- Group queue enforces per-group serialization and global concurrency limit
- Active container tracking: map of groupFolder → containerProcess for multi-turn routing

## Error handling

| Error | Handling |
|-------|----------|
| Channel disconnects | Log warning, attempt reconnect on next poll cycle |
| Container timeout | Kill container, log error, continue polling |
| Container crash | Log error with exit code, roll back cursor if no output sent |
| DB error | Log error, exit(1) — DB errors are unrecoverable |
| IPC parse error | Move file to errors/, log warning, continue |
| Scheduler task error | Log in task_run_logs, retry on next poll |
| ENOMEM / disk full | Log error, exit(1) |
