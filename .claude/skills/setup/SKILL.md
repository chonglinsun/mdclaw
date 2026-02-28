---
disable-model-invocation: true
---

# /setup — Full System Setup

Single command that generates, configures, and verifies a complete mdclaw assistant. This is the only skill most users need to run.

**Principle:** When something is broken or missing, fix it. Don't tell the user to go fix it themselves unless it genuinely requires their manual action (e.g., scanning a QR code, providing a bot token).

## Prerequisites

None — this is the entry point. Run it on a fresh clone.

## Context

This skill absorbs the work of `/init`, `/add-core`, `/add-containers`, `/add-scheduler`, `/add-orchestrator`, channel skills, and `/test` into a single execution. It references the same anchor files and contracts those skills use:

- **`.claude/skills/add-core/types-contract.ts`** — all TypeScript interfaces (copy verbatim into `src/types.ts`)
- **`.claude/skills/add-core/schema.sql`** — all CREATE TABLE statements (use verbatim in `src/db.ts`)
- **`.claude/skills/add-containers/ipc-protocol.md`** — IPC protocol specification
- **`.claude/skills/add-orchestrator/state-machine.md`** — orchestrator state machine

Read ALL of these files before generating code.

## Steps to perform

### Phase 1: Project scaffold (absorbs /init)

Generate the project skeleton. Read the full specification from `.claude/skills/init/SKILL.md` and create:

| File | Purpose |
|------|---------|
| `package.json` | Dependencies, scripts, metadata — exactly as specified in `/init` |
| `tsconfig.json` | TypeScript compiler config — exactly as specified in `/init` |
| `vitest.config.ts` | Test runner config — exactly as specified in `/init` |
| `.env.example` | Template for environment variables — exactly as specified in `/init` |
| `src/` | Directory for generated code |
| `store/` | Directory with `.gitkeep` |
| `data/` | Directory with `.gitkeep` |

### Phase 1.5: Build agent-runner

The agent-runner is shipped as real code in `container/agent-runner/`. Install and build it:

```bash
cd container/agent-runner && npm install && npm run build
```

If this fails, diagnose and fix. The agent-runner must build before the Docker image can be created.

### Phase 2: Core modules (absorbs /add-core)

Generate all foundation modules. Read the full specification from `.claude/skills/add-core/SKILL.md` and create:

| File | Purpose |
|------|---------|
| `src/types.ts` | All TypeScript interfaces — **verbatim from `types-contract.ts`** |
| `src/config.ts` | Constants and configuration (including `CONTAINER_IMAGE`, `ASSISTANT_NAME`) |
| `src/env.ts` | Selective .env loading (NO `dotenv.config()`), zod validation |
| `src/logger.ts` | Pino logger setup |
| `src/db.ts` | SQLite database init and all query functions (with `jid` column) |
| `src/router.ts` | Group registration, message routing, state management |
| `src/group-folder.ts` | Group folder name validation |
| `src/db.test.ts` | Unit tests for db module |
| `src/group-folder.test.ts` | Unit tests for group folder validation |
| `src/env.test.ts` | Unit tests for env security |

Follow every behavioral requirement in the `/add-core` skill spec. The types and schema MUST be copied verbatim from the anchor files.

### Phase 3: Container and IPC modules (absorbs /add-containers)

Generate container execution layer. Read the full specification from `.claude/skills/add-containers/SKILL.md` and the IPC protocol from `.claude/skills/add-containers/ipc-protocol.md`, then create:

| File | Purpose |
|------|---------|
| `src/container.ts` | Container lifecycle: build, run (with `ContainerInput` JSON stdin), parse output, cleanup orphans |
| `src/container-runtime.ts` | Container runtime abstraction (Docker, Apple Container) |
| `src/mount-security.ts` | Mount path validation and security |
| `src/ipc.ts` | File-based IPC watcher, command dispatcher, follow-up message writer |
| `src/container.test.ts` | Unit tests for container output parsing and mount security |
| `src/container-runtime.test.ts` | Unit tests for runtime detection |

Follow every behavioral requirement in the `/add-containers` skill spec. Note: Dockerfile is NOT generated — it's shipped in `container/Dockerfile`.

### Phase 4: Scheduler and queue (absorbs /add-scheduler)

Generate task scheduling layer. Read the full specification from `.claude/skills/add-scheduler/SKILL.md` and create:

| File | Purpose |
|------|---------|
| `src/scheduler.ts` | Cron/interval/once task scheduling and execution |
| `src/group-queue.ts` | Per-group FIFO queue with global concurrency limit |
| `src/scheduler.test.ts` | Unit tests for scheduler logic |

Follow every behavioral requirement in the `/add-scheduler` skill spec.

### Phase 5: Orchestrator (absorbs /add-orchestrator)

Generate main entry point. Read the full specification from `.claude/skills/add-orchestrator/SKILL.md` and the state machine from `.claude/skills/add-orchestrator/state-machine.md`, then create:

| File | Purpose |
|------|---------|
| `src/index.ts` | Main entry point: init, polling loop, ContainerInput construction, streaming output, shutdown |
| `src/message-processor.ts` | XML message formatting, trigger detection, internal tag stripping |
| `src/message-processor.test.ts` | Unit tests for message processor |

Follow every behavioral requirement in the `/add-orchestrator` skill spec.

### Phase 6: Channel selection (interactive)

Ask the user which channels to install (multiple allowed):

- **WhatsApp** (via Baileys) — requires QR code / pairing code on first run
- **Telegram** (via Grammy) — requires bot token from @BotFather
- **Discord** (via discord.js) — requires bot token from Discord Developer Portal
- **Slack** (via @slack/bolt) — requires bot token + app token with Socket Mode
- **Headless/API** (via node:http) — HTTP API for programmatic access, webhooks, custom UIs

Then generate the selected channel(s):

**If WhatsApp selected:** Read `.claude/skills/add-whatsapp/SKILL.md` and create:
- `src/channels/whatsapp.ts` — with Baileys ^7, pairing code auth, LID translation, outbound queue
- `src/channels/whatsapp-auth.ts` — standalone auth utility
- `src/channels/whatsapp.test.ts`
- Wire into `src/index.ts`

**If Telegram selected:** Read `.claude/skills/add-telegram/SKILL.md` and create:
- `src/channels/telegram.ts`
- `src/channels/telegram.test.ts`
- Wire into `src/index.ts`
- Ask the user for their `TELEGRAM_BOT_TOKEN`

**If Discord selected:** Read `.claude/skills/add-discord/SKILL.md` and create:
- `src/channels/discord.ts`
- `src/channels/discord.test.ts`
- Wire into `src/index.ts`
- Ask the user for their `DISCORD_BOT_TOKEN`

**If Slack selected:** Read `.claude/skills/add-slack/SKILL.md` and create:
- `src/channels/slack.ts`
- `src/channels/slack.test.ts`
- Wire into `src/index.ts`
- Ask the user for their `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN`

**If Headless selected:** Read `.claude/skills/add-headless/SKILL.md` and the `headless-protocol.md` anchor contract, then create:
- `src/channels/headless.ts`
- `src/channels/headless.test.ts`
- Wire into `src/index.ts`
- Ask the user for their preferred `HEADLESS_PORT` (default 3000) and `HEADLESS_SECRET`

**If Gmail selected:** Read `.claude/skills/add-gmail/SKILL.md` and create:
- `src/channels/gmail.ts`
- `src/channels/gmail.test.ts`
- Wire into `src/index.ts`
- Ask the user for their `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`
- Ask if channel mode (inbound + outbound) or tool mode (outbound only)

### Phase 7: Install dependencies

```bash
npm install
```

If install fails, diagnose and fix. Common issues: missing system dependencies, Node version too old. Fix what can be fixed, explain what requires user action.

### Phase 8: Type check

```bash
npx tsc --noEmit
```

This MUST pass with zero errors. If it fails, fix the type errors and re-run. Do not proceed until this passes. TypeScript is the cross-skill integration test — if it passes, all modules are consistent.

### Phase 9: Run tests

```bash
npx vitest run
```

All tests must pass. If any fail, fix the test or the code and re-run.

### Phase 10: Configure environment

Create `.env` from `.env.example`:

1. Copy `.env.example` to `.env`
2. Set defaults: `STORE_DIR=./store`, `DATA_DIR=./data`, `MAIN_GROUP_FOLDER=main`, `ASSISTANT_NAME=Andy`
3. If Telegram was selected: write the bot token the user provided into `.env`
4. Create required directories:
   - `${STORE_DIR}/`
   - `${STORE_DIR}/auth_info/`
   - `${DATA_DIR}/`
   - `${DATA_DIR}/ipc/`
   - `${DATA_DIR}/${MAIN_GROUP_FOLDER}/`
   - `${DATA_DIR}/sessions/`
   - `${DATA_DIR}/global/`
5. Create `${DATA_DIR}/${MAIN_GROUP_FOLDER}/CLAUDE.md` with default template:

```markdown
# Main Group

This is the admin group for your mdclaw assistant.

## Instructions

You are a helpful AI assistant. Respond concisely and accurately.
```

6. Create `${DATA_DIR}/global/CLAUDE.md` with shared instructions template:

```markdown
# Shared Instructions

These instructions apply to all groups.

## Guidelines

- Be helpful, concise, and accurate
- Use the available tools when needed
- Schedule tasks for recurring operations
```

7. Create personality file templates:

   `${DATA_DIR}/${MAIN_GROUP_FOLDER}/IDENTITY.md`:
   ```markdown
   # Identity

   You are Andy, a helpful AI assistant for this group.

   ## Personality
   - Friendly and approachable
   - Concise but thorough
   - Proactive about offering help
   ```

   `${DATA_DIR}/${MAIN_GROUP_FOLDER}/SOUL.md`:
   ```markdown
   # Principles

   ## Communication
   - Be direct and clear
   - Adapt tone to the conversation
   - Use tools proactively when they help

   ## Values
   - Accuracy over speed
   - Helpfulness without being intrusive
   - Respect privacy and security
   ```

   `${DATA_DIR}/global/IDENTITY.md`:
   ```markdown
   # Shared Identity

   These identity traits apply to all groups unless overridden by group-specific IDENTITY.md.
   ```

   `${DATA_DIR}/global/SOUL.md`:
   ```markdown
   # Shared Principles

   These principles apply to all groups unless overridden by group-specific SOUL.md.

   ## Core Values
   - Be helpful, accurate, and respectful
   - Use available tools when they add value
   - Protect user privacy and security
   ```

### Phase 11: Build Docker image

```bash
docker build -t mdclaw -f container/Dockerfile .
```

If Docker is not available, warn the user but continue — container execution won't work until Docker is installed, but the rest of the system is functional.

### Phase 12: Build project

```bash
npm run build
```

Must succeed. Fix any issues.

### Phase 12.5: Generate contract-derived tests

Run the `/generate-tests` skill to produce contract-derived test files. Read `.claude/skills/generate-tests/SKILL.md` and execute it:

1. Create `test/contracts/` and `test/boundary/` directories
2. Generate 5 test files that verify contract conformance at integration boundaries
3. Rewrite `test/integration.test.ts` to use real imports instead of inline copies

Then verify:

```bash
npx vitest run test/contracts/ test/boundary/
```

All generated tests must pass. If any fail, fix the generated code and re-run.

### Phase 13: Verification (absorbs /verify)

Run the full verification checklist:

1. **Type safety:** `npx tsc --noEmit` — zero errors
2. **Unit tests:** `npx vitest run` — all pass
3. **Build:** `npm run build` — compiles to `dist/`
4. **Agent-runner build:** `container/agent-runner/dist/` exists
5. **File inventory:** all expected source files exist
6. **Type contract:** `src/types.ts` matches anchor `types-contract.ts`
7. **Schema consistency:** all tables from `schema.sql` are in `src/db.ts`
8. **Import graph:** no circular imports (nothing imports from `index.ts`)
9. **Docker:** image built (or warned)
10. **Config:** `.env` exists with all required vars
11. **Env security:** secrets NOT in `process.env`

### Phase 13.5: Container smoke test

If Docker is available, run the container smoke test:

```bash
bash test/container-test.sh
```

This verifies:
- Agent-runner starts inside the container
- Sentinel markers appear in output
- Clean exit

### Phase 14: Run /test

After all generation + build phases, run the full `/test` checklist. Read `.claude/skills/test/SKILL.md` and execute all 15 checks. Only proceed to "start" if everything passes.

Print results as a table:

```
mdclaw setup complete!
======================

 #  | Check                    | Status
----|--------------------------|-------
  1 | Type safety              | PASS
  2 | Unit tests               | PASS
  3 | Build                    | PASS
  4 | Agent-runner build       | PASS
  5 | File inventory           | PASS
  6 | Type contract            | PASS
  7 | Schema consistency       | PASS
  8 | Import graph             | PASS
  9 | Docker                   | PASS
 10 | Config                   | PASS
 11 | Env security             | PASS
 12 | Container smoke test     | PASS
 13 | Integration test         | PASS

Next steps:
1. Run: npm run dev
2. Scan the WhatsApp QR code / enter pairing code (if using WhatsApp)
3. Send a message to your bot!
```

### Phase 15: Start (optional)

Ask the user if they want to start the application now:

```bash
npm run dev
```

If WhatsApp is configured, the pairing code flow or QR code will appear — tell the user to scan/enter it. If Telegram, the bot will connect automatically.

## Error handling philosophy

- If `npm install` fails → diagnose, fix, retry
- If `tsc` fails → fix type errors, retry
- If tests fail → fix code or tests, retry
- If Docker isn't available → warn, skip Docker steps, continue
- If agent-runner build fails → diagnose, fix, retry
- If a file already exists → overwrite it (this is a setup command, it should be idempotent)
- Never leave the user with a broken state — either fix it or explain exactly what manual step is needed

## Verification

This skill's verification is Phase 13/14. If all checks pass, the system is ready.
