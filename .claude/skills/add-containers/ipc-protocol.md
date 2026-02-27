# IPC Protocol Specification

## Overview

mdclaw uses a **file-based directory-polling IPC protocol** for communication between containers and the host process. Containers write JSON command files to a shared directory; the host polls and processes them.

## Directory structure

```
${DATA_DIR}/ipc/
├── ${group_folder_1}/
│   ├── messages/       # Outbound messages from container
│   ├── tasks/          # Task management commands
│   ├── input/          # Host writes follow-up messages for active containers
│   ├── current_tasks.json    # Host writes task snapshot before container run
│   └── available_groups.json # Host writes group list (main group only)
├── ${group_folder_2}/
│   ├── messages/
│   ├── tasks/
│   └── input/
└── errors/             # Failed command files with error info
```

## Follow-up message delivery

When a message arrives for a group that has an active running container, the host writes the message as a JSON file to `ipc/${group_folder}/input/`. The container's `MessageStream` polls this directory and feeds new messages as additional user turns into the running Claude Agent SDK conversation.

### Input file format

```json
{
  "sender": "user@example.com",
  "sender_name": "Alice",
  "content": "Follow-up message text",
  "timestamp": "2024-01-23T12:01:00.000Z"
}
```

### Close sentinel

To signal the container to finish its multi-turn session, the host writes an empty file named `_close` to the input directory: `ipc/${group_folder}/input/_close`. The MessageStream detects this and terminates the async iterator.

## Pre-run data files

### current_tasks.json

Before starting a container, the host writes the group's scheduled tasks to `ipc/${group_folder}/current_tasks.json`. The container's `list_tasks` MCP tool reads this file. Format: array of `ScheduledTask` objects.

### available_groups.json

For main group containers only, the host writes all registered groups to `ipc/${group_folder}/available_groups.json`. The container's `list_groups` MCP tool reads this file. Format: array of `RegisteredGroup` objects.

## Command file format

Each command is a single JSON file written atomically (write to temp file, then rename). Filename format: `${timestamp}-${random}.json`

```json
{
  "type": "schedule_task",
  "payload": {
    "prompt": "Check weather and post update",
    "schedule_type": "cron",
    "schedule_value": "0 8 * * *",
    "context_mode": "group"
  },
  "source_group": "weather-bot"
}
```

## Command types

### schedule_task

Creates a new scheduled task.

**Payload fields:**
- `prompt` (string, required) — the prompt to execute
- `schedule_type` (`'cron' | 'interval' | 'once'`, required)
- `schedule_value` (string, required) — cron expression, interval in ms, or ISO timestamp
- `context_mode` (`'group' | 'isolated'`, optional, default: `'group'`)
- `chat_jid` (string, optional) — target chat; defaults to source group's chat

### pause_task

Pauses an active task.

**Payload fields:**
- `task_id` (string, required)

### resume_task

Resumes a paused task.

**Payload fields:**
- `task_id` (string, required)

### cancel_task

Cancels (completes) a task permanently.

**Payload fields:**
- `task_id` (string, required)

### refresh_groups

Re-reads group registrations from the database. **Main group only.**

**Payload fields:** none

### register_group

Registers a new group. **Main group only.**

**Payload fields:**
- `name` (string, required)
- `folder` (string, required)
- `trigger` (string, optional, default: `'@Andy'`)
- `chat_jid` (string, required)

## Authorization model

### Verification steps

1. **Source identity**: The `source_group` field must match the directory path the file was found in. Files in `ipc/weather-bot/tasks/` must have `"source_group": "weather-bot"`. Mismatches are rejected.

2. **Main group check**: For `refresh_groups` and `register_group`, the source group must be the main group (matching `MAIN_GROUP_FOLDER` env var). Non-main groups cannot register or refresh.

3. **Ownership check**: For task operations (`pause_task`, `resume_task`, `cancel_task`), non-main groups can only modify tasks belonging to their own `group_folder`. The main group can modify any task.

### Rejection handling

Unauthorized commands are:
1. Logged at `warn` level with source group, command type, and reason
2. The command file is moved to `errors/` with rejection metadata appended
3. No error is sent back to the container (fail silently from container's perspective)

## Processing guarantees

- **At-most-once delivery**: Each file is processed and deleted atomically. If processing fails, the file is moved to `errors/` — never reprocessed automatically.
- **Ordering**: Files within a directory are processed in filename order (timestamp-based), providing approximate chronological ordering.
- **Polling interval**: 1000ms (`IPC_POLL_INTERVAL`). Commands may take up to 1 second to be noticed.

## Error directory

Failed commands are moved to `${DATA_DIR}/ipc/errors/` with the original filename plus `.error` suffix. An additional `.error.json` file is created alongside with:

```json
{
  "original_file": "1706000000-abc123.json",
  "error": "Unauthorized: non-main group cannot register_group",
  "processed_at": "2024-01-23T12:00:00.000Z",
  "source_group": "untrusted-group"
}
```
