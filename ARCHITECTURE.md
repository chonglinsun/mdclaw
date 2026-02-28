# mdclaw Architecture

## What mdclaw is

mdclaw is a personal AI assistant framework that runs Claude inside sandboxed containers, wired to messaging channels (WhatsApp, Telegram, Discord, Slack, HTTP API, Gmail). It is a reimplementation of [nanoclaw](https://github.com/qwibitai/nanoclaw) with a different philosophy: instead of shipping a full TypeScript application, mdclaw ships **markdown skill files** that Claude Code executes to generate the application at setup time.

The result is the same working system — but with 80% less shipped code.

## Core idea

```
nanoclaw:  ship code → run code
mdclaw:    ship instructions → Claude generates code → run code
```

The repo contains three layers:

1. **Real code** — the agent-runner (runs inside containers) and tests. This is TypeScript source that gets compiled into a Docker image.
2. **Skill files** — markdown instructions (`.claude/skills/*/SKILL.md`) that tell Claude Code what TypeScript to generate for the host application.
3. **Anchor contracts** — type definitions, SQL schemas, and protocol specs that are the single source of truth shared across all skills. TypeScript's type checker is the cross-skill integration test.

## System overview

```
                    ┌─────────────────────────────────────────────┐
                    │                Host (Node.js)               │
                    │                                             │
  ┌──────────┐     │  ┌──────────┐  ┌────────┐  ┌────────────┐  │
  │ WhatsApp │◄───►│  │ Channels │  │ Router │  │ Scheduler  │  │
  │ Telegram │◄───►│  │          │──►│        │──►│            │  │
  │ Discord  │◄───►│  │          │  │        │  │            │  │
  │ Slack    │◄───►│  │          │  │        │  │            │  │
  │ Headless │◄───►│  │          │  │        │  │            │  │
  │ Gmail    │◄───►│  └──────────┘  └───┬────┘  └─────┬──────┘  │
  └──────────┘     │                    │              │         │
                    │               ┌────▼──────────────▼──┐      │
                    │               │   Message Processor   │      │
                    │               │   + Group Queue       │      │
                    │               └──────────┬───────────┘      │
                    │                          │                  │
                    │               ┌──────────▼───────────┐      │
                    │               │   Container Runner    │      │
                    │               │   (Docker / Apple)    │      │
                    │               └──────────┬───────────┘      │
                    └──────────────────────────┼──────────────────┘
                                               │
                              stdin (JSON)      │     stdout (sentinels)
                              ┌────────────────►│◄────────────────┐
                              │                 │                 │
                    ┌─────────▼─────────────────▼─────────────────▼──┐
                    │              Container (sandboxed)              │
                    │                                                │
                    │  ┌──────────────┐  ┌───────────┐  ┌────────┐  │
                    │  │ Agent Runner │  │ MCP Tools │  │ Claude │  │
                    │  │   (Node.js)  │──►│           │──►│  SDK   │  │
                    │  └──────────────┘  └───────────┘  └────────┘  │
                    │                                                │
                    │  ┌──────────────┐  ┌────────────────────────┐  │
                    │  │ Personality  │  │ Browser (agent-browser) │  │
                    │  │ IDENTITY.md  │  │ Chromium + Playwright   │  │
                    │  │ SOUL.md      │  └────────────────────────┘  │
                    │  └──────────────┘                              │
                    └────────────────────────────────────────────────┘
```

## Data flow

### Inbound message

```
1. Channel receives message (e.g. WhatsApp group text)
2. Channel constructs NewMessage, calls onMessage(chatJid, message)
3. Router stores message in SQLite, updates chat metadata
4. Orchestrator poll loop detects new messages for a registered group
5. Message processor evaluates trigger (main group: always; others: @trigger match)
6. If triggered: build XML context from recent messages, enqueue to group queue
7. Group queue enforces per-group serialization + global max-5-concurrent limit
8. Container runner builds ContainerInput JSON, launches container
9. Container receives JSON on stdin, agent-runner passes prompt to Claude SDK
10. Claude thinks, uses MCP tools (send_message, schedule_task, etc.)
11. Agent-runner emits sentinel-marked text blocks on stdout
12. Container runner parses sentinels, delivers text via the originating channel
```

### Container I/O protocol

**Input:** `ContainerInput` JSON on stdin:
```json
{
  "prompt": "<context>\n<msg>...</msg>\n</context>\nRespond to the above.",
  "sessionId": "uuid-v4",
  "groupFolder": "main",
  "chatJid": "120363xxx@g.us",
  "isMain": true,
  "isScheduledTask": false,
  "assistantName": "Andy",
  "secrets": { "ANTHROPIC_API_KEY": "sk-..." }
}
```

**Output:** Sentinel-marked blocks on stdout:
```
---NANOCLAW_OUTPUT_START---
Here's what I found...
---NANOCLAW_OUTPUT_END---
```

Multiple sentinel blocks = streaming delivery. Each block is sent to the channel as it arrives.

**Side-channel:** MCP tools write IPC command files to the mounted `ipc/` directory for structured actions (scheduling tasks, registering groups). The host polls these directories and processes commands asynchronously.

### IPC protocol

```
data/ipc/{group_folder}/
├── messages/    # Container writes outbound messages here
├── tasks/       # Container writes task management commands here
├── input/       # Host writes follow-up messages for active containers
└── current_tasks.json    # Host writes task snapshot before container starts
```

Commands are JSON files written atomically (write `.tmp`, then `rename()`). Each command has a `type`, `payload`, and `source_group` field. Authorization: `source_group` must match the directory; `register_group` and `refresh_groups` are main-group-only.

Follow-up messages enable multi-turn: the host writes new messages from the chat to `ipc/{group}/input/`, and the agent-runner's `MessageStream` picks them up. A `_close` sentinel file signals the container to finish.

## File structure

### What's in the repo (shipped)

```
mdclaw/
├── CLAUDE.md                          # Project instructions for Claude Code
├── ARCHITECTURE.md                    # This file
├── .env.example                       # Environment variable template
│
├── .claude/skills/                    # Skill files (instructions, not code)
│   ├── setup/SKILL.md                 #   Master orchestrator
│   ├── init/SKILL.md                  #   Project scaffold
│   ├── add-core/                      #   Foundation layer
│   │   ├── SKILL.md
│   │   ├── types-contract.ts          #   Anchor: all TypeScript interfaces
│   │   └── schema.sql                 #   Anchor: all SQLite tables
│   ├── add-containers/                #   Container lifecycle
│   │   ├── SKILL.md
│   │   └── ipc-protocol.md            #   Anchor: IPC protocol spec
│   ├── add-scheduler/SKILL.md         #   Task scheduler
│   ├── add-orchestrator/              #   Main loop + message processor
│   │   ├── SKILL.md
│   │   └── state-machine.md           #   Anchor: orchestrator FSM
│   ├── add-whatsapp/SKILL.md          #   WhatsApp channel (Baileys v7)
│   ├── add-telegram/SKILL.md          #   Telegram channel (Grammy)
│   ├── add-discord/SKILL.md           #   Discord channel (discord.js v14)
│   ├── add-slack/SKILL.md             #   Slack channel (Bolt v3)
│   ├── add-headless/                  #   HTTP API channel
│   │   ├── SKILL.md
│   │   └── headless-protocol.md       #   Anchor: HTTP endpoint spec
│   ├── add-gmail/SKILL.md             #   Gmail channel (googleapis)
│   ├── add-telegram-swarm/SKILL.md    #   Multi-bot Telegram identities
│   ├── add-voice-transcription/SKILL.md  # Whisper voice transcription
│   ├── add-x-integration/SKILL.md     #   X/Twitter browser automation
│   ├── add-parallel/SKILL.md          #   Web search MCP injection
│   ├── add-service/SKILL.md           #   launchd/systemd service files
│   ├── customize/SKILL.md             #   Post-setup modifications
│   ├── debug/SKILL.md                 #   Troubleshooting guide
│   ├── test/SKILL.md                  #   17-check pre-flight verification
│   ├── generate-tests/SKILL.md        #   Contract-derived test generation
│   ├── convert-to-apple-container/SKILL.md  # Docker → Apple Container
│   ├── update/SKILL.md                #   Upstream merge helper
│   ├── get-qodo-rules/SKILL.md        #   Coding convention extraction
│   └── qodo-pr-resolver/SKILL.md      #   PR review comment fixer
│
├── container/
│   ├── Dockerfile                     # node:22-slim + Chromium + agent-runner
│   ├── build.sh                       # Build wrapper
│   ├── skills/                        # In-container instruction files
│   │   ├── agent-browser/SKILL.md     #   Browser automation reference
│   │   └── x-integration/SKILL.md     #   X/Twitter automation reference
│   └── agent-runner/                  # Real TypeScript code
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts               #   Entry: stdin → Claude SDK → stdout
│           ├── mcp-server.ts          #   MCP tools for the agent
│           ├── message-stream.ts      #   Multi-turn follow-up polling
│           ├── ipc-writer.ts          #   Atomic file-based IPC
│           ├── security-hooks.ts      #   PreToolUse bash hook to strip secrets
│           └── transcript.ts          #   Conversation archival
│
└── test/
    ├── integration.test.ts            # Pipeline simulation test
    ├── contract-harness.ts            # Anchor contract parser library
    └── container-test.sh              # Container smoke test
```

### What gets generated (by /setup)

```
src/
├── types.ts              # Copied verbatim from types-contract.ts
├── config.ts             # Constants + env-derived settings
├── env.ts                # Custom .env parser (no dotenv.config())
├── logger.ts             # Pino logger
├── db.ts                 # SQLite init + WAL mode (schema from schema.sql)
├── router.ts             # Group registration, message storage, state
├── group-folder.ts       # Folder name validation
├── container.ts          # Docker/Apple Container process management
├── container-runtime.ts  # Runtime abstraction layer
├── mount-security.ts     # Mount path allowlist enforcement
├── ipc.ts                # Directory watcher + command processor
├── scheduler.ts          # Cron/interval/once task execution
├── group-queue.ts        # Per-group FIFO + global concurrency
├── message-processor.ts  # XML context, trigger detection, tag stripping
├── index.ts              # Main orchestrator (state machine)
└── channels/
    ├── whatsapp.ts        # Baileys v7, pairing code, LID, outbound queue
    ├── whatsapp-auth.ts   # Standalone auth utility
    ├── telegram.ts        # Grammy long-polling
    ├── discord.ts         # discord.js v14, intents, reply context
    ├── slack.ts           # Bolt v3, Socket Mode
    ├── headless.ts        # node:http server, Bearer auth
    └── gmail.ts           # googleapis OAuth2, channel or tool mode
```

## Key design decisions

### Why markdown skills instead of real code?

The host application (`src/`) is ~3,000 lines of straightforward TypeScript — config loading, SQLite queries, polling loops, channel adapters. It's the kind of code Claude Code generates reliably from clear specifications. Shipping it as markdown instructions means:

- **Less code to maintain.** Bug fixes to a skill file fix all future installations.
- **Self-healing.** If a generated file gets corrupted, re-running the skill regenerates it.
- **Customizable by conversation.** Users can say "change the trigger word" and Claude modifies the right files, guided by the skill context.
- **No merge conflicts.** Upstream updates to skill files don't conflict with user customizations in `src/`.

The trade-off is non-determinism: two `/setup` runs may produce slightly different code. The anchor contracts mitigate this — they pin the interfaces, schema, and protocols exactly, so the generated code must conform to fixed boundaries.

### Why real code for the agent-runner?

The agent-runner runs inside containers where Claude Code isn't available to regenerate it. It must be compiled at Docker image build time. It also has the most complex integration surface (Claude SDK, MCP protocol, multi-turn streaming, IPC file system), where subtle bugs are hard to specify in prose. Real code with real tests is the right choice here.

### Anchor contracts as integration tests

The four anchor contracts serve double duty:

1. **At generation time:** Skills read them to know exactly what interfaces to implement, what schema to create, what IPC commands to handle.
2. **At test time:** The contract harness (`test/contract-harness.ts`) parses them into structured data, and contract-derived tests verify the generated code conforms.

TypeScript's type checker is the ultimate integration test. If `npx tsc --noEmit` passes after running all skills, every generated file agrees on types, function signatures, and import paths.

### Container sandbox model

Each conversation turn runs in an isolated container:

- **No network persistence.** Containers are ephemeral — started for each message batch, destroyed after.
- **No host access.** The container sees only mounted directories (`/data`, `/ipc`, `/app`) and stdin/stdout.
- **Secrets via stdin.** API keys are sent in the `ContainerInput` JSON, never baked into the image. For Apple Container (where `-e` flags are buggy with stdin), secrets are written to a temp file mounted at `/secrets.json`.
- **Environment sanitization.** Secrets are merged into an isolated `sdkEnv` clone — never written to `process.env`. The SDK receives `sdkEnv` via `options.env` for API authentication. A `PreToolUse` hook on `Bash` prepends `unset ANTHROPIC_API_KEY CLAUDE_CODE_OAUTH_TOKEN CLAUDE_API_KEY` to every shell command, preventing Claude's bash tool from reading keys even though the SDK process has them.

### Multi-turn conversations

When a container is running and new messages arrive in the chat:

1. Host writes them as JSON files to `ipc/{group}/input/`
2. Agent-runner's `MessageStream` polls this directory every 500ms
3. Each new message triggers a `query()` call with `resume: sdkSessionId` to continue the same Claude conversation
4. `resumeSessionAt: lastAssistantUuid` ensures the resume picks up from the exact right point
5. When the host decides the conversation is over, it writes a `_close` sentinel file

### Personality system

Each group can have its own personality files:

- `data/{group}/IDENTITY.md` — who the assistant is (name, role, traits)
- `data/{group}/SOUL.md` — behavioral principles (values, communication style)

These are mounted into the container at `/data/` and prepended to the system prompt. Global defaults in `data/global/` apply when group-specific files don't exist.

### Channel abstraction

All channels implement the same `Channel` interface:

```typescript
interface Channel {
  name: string;
  connect(): Promise<void>;
  sendMessage(jid: string, text: string): Promise<void>;
  isConnected(): boolean;
  ownsJid(jid: string): boolean;
  disconnect(): Promise<void>;
  setTyping?(jid: string, isTyping: boolean): Promise<void>;
}
```

Each channel has a distinct JID prefix that `ownsJid()` checks:

| Channel | JID format | Example |
|---------|-----------|---------|
| WhatsApp | `{phone}@s.whatsapp.net` or `{id}@g.us` | `120363xxx@g.us` |
| Telegram | `tg:{chatId}` | `tg:-1001234567` |
| Discord | `dc:{channelId}` | `dc:1234567890` |
| Slack | `slack:{channelId}` | `slack:C01ABC23DEF` |
| Headless | `hl:{channelId}` | `hl:default` |
| Gmail | `gmail:{email}` | `gmail:user@gmail.com` |

The orchestrator iterates all connected channels to find which one owns a given JID and routes outbound messages accordingly.

## Orchestrator state machine

```
INITIALIZING ──► RECOVERING ──► POLLING ◄──┐
                                   │        │
                                   ▼        │
                              PROCESSING ───┘
                                   │
                                   ▼
                              EXECUTING ────► POLLING
                                   │
                              (on SIGTERM/SIGINT)
                                   ▼
                             SHUTTING_DOWN ──► STOPPED
```

- **INITIALIZING:** Load env, init DB, build container image, create all subsystems, connect channels.
- **RECOVERING:** Check for backlog messages in all registered groups.
- **POLLING:** Every 2 seconds, check each group for new messages.
- **PROCESSING:** Evaluate trigger conditions, build XML context from message history.
- **EXECUTING:** Run container, stream output, handle IPC commands.
- **SHUTTING_DOWN:** Stop timers, write `_close` sentinels, wait for containers (30s max), disconnect, exit.

Concurrency: single Node.js process, per-group serialization via group queue, global limit of 5 concurrent containers.

## Security model

| Boundary | Protection |
|----------|-----------|
| Main vs non-main groups | Main group has admin privileges (register groups, refresh). Non-main groups can only manage their own tasks. |
| Inbound messages | Treated as potential prompt injection. Wrapped in XML context tags. Internal `<internal>...</internal>` tags stripped from outbound. |
| Container isolation | Sandboxed process with mounted directories only. No host network access. |
| API keys | Stdin delivery → isolated `sdkEnv` clone (never `process.env`). `PreToolUse` bash hook strips keys from shell subprocesses. Never in `process.env` on host. |
| IPC authorization | `source_group` must match directory. Cross-group escalation prevented by namespace isolation. |
| Mount paths | Allowlist-validated. Non-main groups get read-only mounts. |
| Group folder names | Validated: `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`. "global" is reserved. |

## Agent swarms

Claude Code has native multi-agent collaboration tools (Task, TaskList, etc.). Inside containers, these work automatically because:

1. The Claude Code CLI is installed globally in the Docker image
2. API keys reach the SDK via `ContainerInput.secrets`
3. The container has a writable home directory (`/home/node/`) for agent coordination state
4. MCP tools provide communication back to the host

No custom swarm infrastructure is needed. Claude spawns sub-agents as needed for complex tasks.

## Setup flow

```
git clone → cd mdclaw → claude → /setup
```

`/setup` orchestrates all phases:

```
Phase 1:    /init             → package.json, tsconfig, dirs
Phase 1.5:  Build agent-runner → compile container TypeScript
Phase 2:    /add-core          → types, config, env, db, router
Phase 3:    /add-containers    → container runner, IPC, runtime
Phase 4:    /add-scheduler     → cron/interval task engine
Phase 5:    /add-orchestrator  → main loop, message processor
Phase 6:    Channels           → user picks from WhatsApp, Telegram,
                                 Discord, Slack, Headless, Gmail
Phase 7-9:  Optional extras    → voice, swarm, browser, service
Phase 10:   Environment        → .env, personality templates
Phase 11:   Dependencies       → npm install
Phase 12:   Container image    → docker build
Phase 13:   Type check         → npx tsc --noEmit
Phase 14:   /test              → 17-check pre-flight verification
```

After setup, `/customize` provides guided modification of any aspect.

## Technology choices

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Node.js 22 | Claude Code SDK is Node-native |
| Language | TypeScript 5.7 strict | Type safety across skill boundaries |
| Database | better-sqlite3 | Synchronous API, no async complexity, WAL mode |
| Logging | Pino | Structured JSON logging, low overhead |
| Container | Docker / Apple Container | Platform-appropriate sandboxing |
| AI | Claude Code SDK (`query()`) | Direct API with MCP tool support, session resume |
| MCP | @modelcontextprotocol/sdk | Standard protocol for agent-tool communication |
| Testing | Vitest | Fast, TypeScript-native, compatible with ESM |
| Browser | agent-browser (Playwright) | Headless Chromium automation inside containers |
