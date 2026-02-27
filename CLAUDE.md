# mdclaw

> nanoclaw rebuilt as pure markdown skills — real agent-runner code + `.md` skill files + anchor contracts.

## What this is

mdclaw ships a set of Claude Code skills that, when executed in order, generate a fully working **nanoclaw-compatible personal AI assistant**. The repo contains real code for the container agent-runner and tests, plus markdown skill files that generate the host application.

## Setup

`/setup` is the primary entry point. It generates all code, installs dependencies, configures the environment, and verifies the system in one command:

```
git clone → cd mdclaw → claude → /setup
```

The layer skills (`/init`, `/add-core`, `/add-containers`, `/add-scheduler`, `/add-orchestrator`, `/add-whatsapp`, `/add-telegram`) are building blocks that `/setup` calls internally. They can be run individually for incremental generation or customization.

## Architecture

### Code split

**Real code (shipped in repo, not generated):**
- `container/agent-runner/` — Claude Agent SDK integration, MCP server, multi-turn support
- `container/Dockerfile` + `container/build.sh` — container image
- `test/integration.test.ts` — pipeline integration test
- `test/container-test.sh` — container smoke test

**Generated code (produced by skills at `/setup` time):**
- Everything in `src/` — host application (types, config, env, db, router, container, ipc, scheduler, group-queue, orchestrator, channels)

**Anchor contracts (in `.claude/skills/`, referenced by skills):**
- `types-contract.ts`, `schema.sql` — type and schema contracts
- `ipc-protocol.md`, `state-machine.md` — behavior specs

### Layer dependency graph

```
/setup (orchestrates all layers)
  ├─ Phase 1:   /init            (project scaffold)
  ├─ Phase 1.5: Build agent-runner
  ├─ Phase 2:   /add-core        (types, config, env, db, router, group-folder)
  ├─ Phase 3:   /add-containers  (container runner, IPC, runtime abstraction)
  ├─ Phase 4:   /add-scheduler   (task scheduler, group queue)
  ├─ Phase 5:   /add-orchestrator (main index.ts wiring, message processor)
  ├─ Phase 6:   /add-whatsapp and/or /add-telegram (channels)
  └─ Phase 14:  /test            (15-check pre-flight verification)
```

### Generated application structure

```
src/
├── types.ts              # Channel, NewMessage, ContainerInput, RegisteredGroup, etc.
├── config.ts             # Environment + constants
├── env.ts                # Selective .env loading (no process.env pollution)
├── logger.ts             # Pino logger
├── db.ts                 # SQLite via better-sqlite3
├── router.ts             # Group registration, message routing, state
├── group-folder.ts       # Group folder name validation
├── container.ts          # Docker container lifecycle (ContainerInput JSON stdin)
├── container-runtime.ts  # Runtime abstraction (Docker, Apple Container)
├── mount-security.ts     # Mount path validation
├── ipc.ts                # File-based IPC watcher + follow-up message delivery
├── scheduler.ts          # Cron/interval/once task runner
├── group-queue.ts        # Per-group FIFO with concurrency control
├── message-processor.ts  # XML message format, trigger detection, tag stripping
├── index.ts              # Main orchestrator loop
└── channels/
    ├── whatsapp.ts        # Baileys v7: pairing code, LID translation, outbound queue
    ├── whatsapp-auth.ts   # Standalone WhatsApp auth utility
    └── telegram.ts        # Grammy integration
```

### Container architecture

```
container/
├── Dockerfile            # node:22-slim + Chromium + agent-runner
├── build.sh              # Build script
└── agent-runner/
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── index.ts          # Entry: read ContainerInput JSON, run Claude SDK
        ├── mcp-server.ts     # MCP tools: send_message, schedule/list/pause/resume/cancel_task
        ├── message-stream.ts # Async iterable for multi-turn follow-up messages
        ├── ipc-writer.ts     # Atomic IPC command file writer
        ├── security-hooks.ts # Strip API keys from subprocess env
        └── transcript.ts     # Archive conversation to markdown
```

## Conventions

### Code generation rules

- **TypeScript 5.7**, strict mode, ES2022 target, NodeNext module resolution
- **Node.js 20+** runtime
- All generated code must pass `npx tsc --noEmit` with zero errors
- Use `better-sqlite3` (synchronous) for SQLite — never use async sqlite
- Use `pino` for logging — never use console.log in production code
- Environment variables loaded via custom selective parser — **never use `dotenv.config()`**
- Secrets stay in `env` object only — **never in `process.env`**
- Pin exact dependency versions in package.json

### Anchor files

Two files serve as the single source of truth across all skills:

1. **`.claude/skills/add-core/types-contract.ts`** — all TypeScript interfaces. Skills must use these types verbatim (copy into `src/types.ts`).
2. **`.claude/skills/add-core/schema.sql`** — all CREATE TABLE statements. Skills must use this schema verbatim in `src/db.ts`.

Additional specs:

3. **`.claude/skills/add-containers/ipc-protocol.md`** — IPC protocol with input/, tasks/, messages/ directories
4. **`.claude/skills/add-orchestrator/state-machine.md`** — orchestrator state machine

TypeScript's type checker is the cross-skill integration test. If `npx tsc --noEmit` passes after running a skill, the skill integrated correctly.

### Skill conventions

- Each skill sets `disable-model-invocation: true` — they're explicit actions
- Each skill runs `npx tsc --noEmit` as its final verification step
- Skills must check prerequisites before generating code
- Generated code imports from relative paths (e.g., `./types`, `./config`)
- Each generated file includes a header comment: `// Generated by mdclaw /skill-name`

### Container I/O

- Container receives `ContainerInput` JSON on stdin (not plain text)
- Container emits sentinel-marked outputs: `---NANOCLAW_OUTPUT_START---` and `---NANOCLAW_OUTPUT_END---`
- Multiple sentinel blocks = streaming delivery (each sent as it arrives)
- Container uses MCP tools for structured actions (send_message, schedule_task, etc.)
- Multi-turn: host writes follow-up messages to `ipc/{group}/input/`
- Close signal: host writes `_close` sentinel to `ipc/{group}/input/`

### Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `POLL_INTERVAL` | 2000 | Message polling interval (ms) |
| `SCHEDULER_POLL_INTERVAL` | 60000 | Task scheduler check interval (ms) |
| `IPC_POLL_INTERVAL` | 1000 | IPC directory polling interval (ms) |
| `IDLE_TIMEOUT` | 1800000 | Container idle timeout (ms, 30 min) |
| `CONTAINER_TIMEOUT` | 1800000 | Max container execution time (ms) |
| `MAX_OUTPUT_SIZE` | 10485760 | Max container output (10 MB) |
| `MAX_CONCURRENT_CONTAINERS` | 5 | Concurrency limit |
| `CONTAINER_RUNTIME` | `'docker'` | Container binary |
| `CONTAINER_IMAGE` | `'mdclaw'` | Docker image name |
| `ASSISTANT_NAME` | `'Andy'` | Default assistant name |

### Security model

- **Main group**: trusted, admin control, can register other groups
- **Non-main groups**: untrusted, restricted, can only manage own tasks
- **Containers**: sandboxed, JSON stdin for secrets, MCP for structured I/O
- **Messages**: treated as potential attack vectors (prompt injection)
- **Internal tags**: `<internal>...</internal>` stripped from outbound messages
- **Environment**: secrets never in `process.env`, only in isolated `env` object
- IPC uses per-group namespaces to prevent cross-group escalation
- Group folder names validated: `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`, "global" reserved

## Verification

After all skills are run:

1. `npx tsc --noEmit` — zero type errors
2. `npx vitest run` — all unit tests pass
3. `npx vitest run test/integration.test.ts` — integration test passes
4. `npm run build` — compiles to `dist/`
5. `npm run dev` — starts without crashing
6. Docker image builds successfully
7. `bash test/container-test.sh` — container smoke test passes
8. `/test` — all 15 pre-flight checks pass
