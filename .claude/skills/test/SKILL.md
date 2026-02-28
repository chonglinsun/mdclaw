---
disable-model-invocation: true
---

# /test — Comprehensive Pre-flight Check

Runs a complete verification suite against the generated mdclaw system. This is the gate — all checks must pass before the system is considered ready.

## Prerequisites

The full system must be generated and built:

- All source files in `src/` generated
- `npm install` completed
- `npm run build` completed
- `container/agent-runner/` built
- Docker image built (optional — Docker checks skip if unavailable)

## Context

This skill runs 17 verification checks that cover type safety, unit tests, build integrity, contract compliance, security, boundary integration, and end-to-end functionality. It is run automatically at the end of `/setup` and can be re-run independently at any time.

## Checks to perform

Run each check and report PASS/FAIL. Continue through all checks even if some fail (don't stop on first failure).

### 1. Type safety

```bash
npx tsc --noEmit
```

Must exit with code 0 and zero errors.

### 2. Unit tests

```bash
npx vitest run
```

All test suites must pass.

### 3. Build

```bash
npm run build
```

Must compile to `dist/` without errors.

### 4. Agent-runner build

Verify `container/agent-runner/dist/index.js` exists. If not, try:

```bash
cd container/agent-runner && npm install && npm run build
```

### 5. File inventory

All expected source files must exist:

```
src/types.ts
src/config.ts
src/env.ts
src/logger.ts
src/db.ts
src/router.ts
src/group-folder.ts
src/container.ts
src/container-runtime.ts
src/mount-security.ts
src/ipc.ts
src/scheduler.ts
src/group-queue.ts
src/message-processor.ts
src/index.ts
```

Plus at least one channel: `src/channels/whatsapp.ts` or `src/channels/telegram.ts`.

Optional channel files (present if respective env var is configured):

```
src/channels/discord.ts     # Present if DISCORD_BOT_TOKEN configured
src/channels/slack.ts       # Present if SLACK_BOT_TOKEN configured
src/channels/headless.ts    # Present if HEADLESS_PORT or HEADLESS_SECRET configured
src/channels/gmail.ts       # Present if GMAIL_CLIENT_ID configured
```

### 6. Type contract

Run the contract-derived type conformance tests:

```bash
npx vitest run test/contracts/types-conformance.test.ts
```

Must pass. This verifies every interface and field from `types-contract.ts` exists in `src/types.ts`, and that `ContainerInput` matches between host and agent-runner.

If the test file doesn't exist, fall back to manual check: compare `src/types.ts` against `.claude/skills/add-core/types-contract.ts` and verify all `export interface` names are present.

### 7. Schema consistency

Run the contract-derived schema conformance tests:

```bash
npx vitest run test/contracts/schema-conformance.test.ts
```

Must pass. This verifies every table, column, CHECK constraint, and index from `schema.sql` exists in the database created by `initDb(':memory:')`.

If the test file doesn't exist, fall back to manual check: verify all `CREATE TABLE` table names from `schema.sql` are referenced in `src/db.ts`.

### 8. Import graph

No circular imports. Specifically:
- Nothing should import from `./index.js` (the entry point)
- Channels should not import from each other
- Core modules (`types`, `config`, `env`, `logger`) should not import application modules

Check with:
```bash
grep -r "from './index" src/ --include="*.ts" | grep -v "src/index.ts"
```

This should return no results.

### 9. Docker image

```bash
docker image inspect mdclaw > /dev/null 2>&1
```

If Docker is not available, mark as SKIP (not FAIL).

### 10. Container smoke test

If Docker is available, run:

```bash
bash test/container-test.sh
```

This verifies:
- Agent-runner starts inside the container
- MCP tools are connected and appear in container output
- Sentinel markers appear in output
- Clean exit

If Docker is not available, mark as SKIP.

### 11. IPC round-trip

Run the contract-derived IPC conformance tests:

```bash
npx vitest run test/contracts/ipc-conformance.test.ts
```

Must pass. This verifies command round-trip for all command types, source_group validation, main group authorization rules, and close sentinel behavior per `ipc-protocol.md`.

If the test file doesn't exist, fall back to manual check: create a test IPC command file, verify it's valid JSON, clean up.

### 12. Channel connectivity

- **Telegram:** If `TELEGRAM_BOT_TOKEN` is set, run `npx tsx -e "..."` to call `getMe` and verify the token is valid
- **WhatsApp:** If auth state exists in `store/auth_info/`, verify the creds file is valid JSON
- If no channel is configured, mark as SKIP

### 13. Env security

Verify that secrets are NOT in `process.env` after env module loads:

```bash
npx tsx -e "
import './src/env.js';
const hasKey = 'ANTHROPIC_API_KEY' in process.env;
if (hasKey) { console.log('FAIL: secrets leaked to process.env'); process.exit(1); }
console.log('OK: secrets not in process.env');
"
```

### 14. Integration test

```bash
npx vitest run test/integration.test.ts
```

The integration test verifies the full pipeline with a mocked container.

### 15. End-to-end mock

Simulate a full message pipeline:

1. Create an in-memory DB
2. Register a test group
3. Store a test message
4. Build ContainerInput
5. Verify ContainerInput structure (all required fields present)
6. Mock a container response with sentinel markers
7. Parse the response
8. Verify the parsed output matches expected

This can be run as an inline script or as part of the integration test.

### 16. State machine conformance

Run the contract-derived state machine conformance tests:

```bash
npx vitest run test/contracts/state-machine-conformance.test.ts
```

Must pass. This verifies all states from `state-machine.md` are referenced in `src/index.ts`, shutdown sequence order, cursor rollback logic, and signal handler registration.

If the test file doesn't exist, mark as SKIP.

### 17. Boundary integration

Run the contract-derived boundary integration tests:

```bash
npx vitest run test/boundary/
```

Must pass. This verifies the 5 real failure boundaries: host→container JSON, container→host sentinels, host↔IPC commands, host↔DB operations, and bot message filtering.

If the test directory doesn't exist or contains no tests, mark as SKIP.

## Output format

Print a summary table:

```
mdclaw test results
====================

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
  9 | Docker image             | PASS
 10 | Container smoke test     | PASS
 11 | IPC round-trip           | PASS
 12 | Channel connectivity     | SKIP
 13 | Env security             | PASS
 14 | Integration test         | PASS
 15 | End-to-end mock          | PASS
 16 | State machine conformance| PASS
 17 | Boundary integration     | PASS

Result: 16/16 passed, 1 skipped
```

If any non-SKIP check fails, the overall result is FAIL and the system is not ready.

## Verification

This skill IS the verification. If all 17 checks pass (or SKIP where noted), the system is ready for `npm run dev`.
