# Path to Zero Shipped Code

> Reduce mdclaw's remaining ~1,070 lines of shipped TypeScript to zero,
> using anchor contracts and markdown skills — without regressing deterministic performance.

## Current real code inventory

```
container/agent-runner/src/
  index.ts          ~280 lines  — query() wiring, multi-turn, IPC polling
  mcp-server.ts     ~220 lines  — 8 MCP tools
  message-stream.ts  ~45 lines  — push-based AsyncIterable
  ipc-writer.ts      ~30 lines  — atomic file write
  security-hooks.ts  ~35 lines  — bash unset hook
  transcript.ts      ~40 lines  — conversation archival

test/
  integration.test.ts ~180 lines — pipeline simulation
  contract-harness.ts ~240 lines — anchor contract parsers
                     ─────────
                     ~1,070 lines total
```

## Why this code is still "real"

Each piece exists as shipped code because of a specific constraint:

| File | Constraint |
|------|-----------|
| agent-runner `index.ts` | Runs inside containers where Claude Code can't regenerate it; must be compiled at Docker build time |
| `mcp-server.ts` | SDK McpServer API is complex (zod schemas, transport); subtle type bugs are silent at runtime |
| `message-stream.ts` | AsyncIterable protocol has exact semantics; off-by-one in push/end/yield causes hangs |
| `contract-harness.ts` | Parsers must be stable foundation — if the parser is wrong, all derived tests are wrong |
| `integration.test.ts` | Contains inline schema/types that must match contracts exactly |

The common thread: **integration surface complexity**. The riskiest code touches the SDK API, async protocols, or serves as the test foundation itself.

## The rigor model

```
                    ┌─────────────────────────┐
                    │    Anchor Contracts      │
                    │  (types, schema, proto)  │
                    └────────┬────────────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │  Skills   │  │ gen-tests│  │   tsc    │
        │ generate  │  │ generate │  │ --noEmit │
        │   code    │  │  tests   │  │          │
        └─────┬────┘  └─────┬────┘  └────┬─────┘
              │              │            │
              ▼              ▼            ▼
        ┌──────────────────────────────────────┐
        │         Generated Code               │
        │   src/  +  agent-runner/  +  test/   │
        └──────────────────────────────────────┘
```

Determinism comes from three layers:

1. **Contracts pin the boundaries** — types, schema, protocols don't drift
2. **TypeScript compiler catches structural mismatches** — wrong field names, missing exports, type incompatibilities
3. **Contract-derived tests verify runtime behavior** — SQL constraints hold, IPC round-trips, sentinel parsing works

The contracts themselves are the stable, human-reviewed foundation. Everything else is generated and verified.

## Phase 1: Agent-runner contract (eliminates ~650 lines)

Create `.claude/skills/add-containers/agent-runner-contract.md` — a new anchor contract that specifies the exact SDK integration:

### query() call shape

```
options:
  cwd: '/data'
  appendSystemPrompt: <built from personality + identity + context>
  permissionMode: 'bypassPermissions'
  env: <clone of process.env + secrets from stdin/secrets.json>
  allowedTools: [Bash, Read, Write, Edit, Glob, Grep, WebSearch, ...]
  mcpServers: { mdclaw: { type: 'sdk', instance: <McpServer> } }
  hooks:
    PreToolUse[Bash]: prepend "unset ANTHROPIC_API_KEY CLAUDE_CODE_OAUTH_TOKEN"
```

### prompt shape

```
AsyncIterable<SDKUserMessage> — push-based stream:
  1. push(initial prompt)
  2. background poll: IPC input/ → push follow-ups
  3. _close sentinel → stream.end()
```

### MCP tools

| Tool | Params | Behavior |
|------|--------|----------|
| send_message | text: string, sender?: string | Write sentinel block to stdout |
| schedule_task | prompt, schedule_type, schedule_value, context_mode? | Write IPC command |
| list_tasks | (none) | Read current_tasks.json |
| pause_task | task_id | Write IPC command |
| resume_task | task_id | Write IPC command |
| cancel_task | task_id | Write IPC command |
| register_group | name, folder, trigger?, chat_jid (main only) | Write IPC command |
| list_groups | (none, main only) | Read available_groups.json |

### Implementation

Create a `/add-agent-runner` skill that generates all 6 source files from this contract. Change the Dockerfile to recompile at container startup (like nanoclaw) instead of Docker build time:

```dockerfile
COPY container/agent-runner/package.json /agent-runner/
WORKDIR /agent-runner
RUN npm install
# Source is mounted/generated at runtime, compiled on container start
ENTRYPOINT ["bash", "-c", "cd /agent-runner && npx tsc && node dist/index.js"]
```

### Why this works without regression

The contract pins every query() option, every MCP tool signature, and the exact AsyncIterable protocol. The skill reads the contract and generates code that conforms. `tsc --noEmit` catches type mismatches. Contract-derived tests verify runtime behavior.

### Risk

The SDK's hook return shape (`hookSpecificOutput.updatedInput`) is undocumented. One wrong field and the bash sanitization silently fails. Mitigation: add a smoke test contract that verifies the hook actually strips env vars.

## Phase 2: Test contract (eliminates ~420 lines)

### Option A — Eliminate the parser entirely (recommended)

Instead of parsing TypeScript source text with regex, use `tsc` directly:

```
For each interface in types-contract.ts:
  1. Import the interface from src/types.ts
  2. Create a value satisfying the contract interface
  3. Assign it to a variable typed as the src/types.ts interface
  4. If tsc passes, the interfaces match
```

No parser needed — **TypeScript IS the parser**.

### Option B — Generate the parser too

The contract-harness parsers are simple regex-based extractors. Specify their exact behavior in the `/generate-tests` skill and let it generate them:

```
parseTypesContract(path) → ParsedInterface[]
  1. Read file as UTF-8
  2. Match /export interface (\w+)\s*\{/ with brace-depth tracking
  3. For each body, extract fields via property/method regex
  4. Return { name, fields: [{ name, type, optional }] }
```

Option A is better — it eliminates an entire layer (the parser) by using the TypeScript compiler as the verification tool.

### Integration test

`integration.test.ts` currently has inline copies of types and schema. The `/generate-tests` skill rewrites it to use real imports from `src/`. Once that's done, the test file is generated, not shipped.

## Phase 3: Dockerfile simplification

With agent-runner source generated (not shipped), the Dockerfile becomes:

```dockerfile
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium libgbm1 libnss3 ... fonts-liberation curl git \
    && rm -rf /var/lib/apt/lists/*
RUN npm install -g @anthropic-ai/claude-code agent-browser
COPY container/agent-runner/package.json /agent-runner/
WORKDIR /agent-runner
RUN npm install
WORKDIR /app
RUN groupmod -g 1000 node && usermod -u 1000 -g 1000 node && chmod 777 /home/node
USER node
ENTRYPOINT ["bash", "-c", "cd /agent-runner && npx tsc && node dist/index.js"]
```

Agent-runner TypeScript source is mounted at runtime from the generated `src/agent-runner/` directory.

## End state

```
Shipped code:         0 lines of TypeScript
Anchor contracts:     6 files (types, schema, ipc, state-machine, headless, agent-runner)
Skills:              ~25 markdown files
Dockerfile:           ~25 lines (install tools, set up dirs)
Generated code:       everything in src/ AND agent-runner/ AND test/
```

## What you'd lose

- **Debuggability**: shipped code has stable line numbers; generated code shifts between runs
- **Diffability**: `git diff` on generated code is noisy; contract diffs are clean
- **Cold start confidence**: first `/setup` run on a fresh machine has no prior verification — you trust the skill + compiler to get it right

## Recommended execution sequence

1. Create the agent-runner contract `.md` file (low effort, high value — documents exact SDK integration)
2. Create `/add-agent-runner` skill that generates from the contract
3. Switch Dockerfile to runtime compilation
4. Eliminate `contract-harness.ts` by using type-level assertions in generated tests

Each step is independently valuable and reversible.
