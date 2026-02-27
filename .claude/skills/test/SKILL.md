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

This skill runs 15 verification checks that cover type safety, unit tests, build integrity, contract compliance, security, and end-to-end functionality. It is run automatically at the end of `/setup` and can be re-run independently at any time.

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

### 6. Type contract

Compare `src/types.ts` against `.claude/skills/add-core/types-contract.ts`. All interfaces defined in the contract must exist in the generated types file. Verify by checking for each `export interface` name.

### 7. Schema consistency

All tables from `.claude/skills/add-core/schema.sql` must appear in `src/db.ts`. Check that each `CREATE TABLE` table name from the schema file is referenced in the db module.

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
- MCP tools are registered
- Sentinel markers appear in output
- Clean exit

If Docker is not available, mark as SKIP.

### 11. IPC round-trip

Create a test IPC command file, verify the structure is correct:

```bash
# Create test directory
mkdir -p data/ipc/test-group/tasks

# Write a test command
echo '{"type":"schedule_task","payload":{"prompt":"test","schedule_type":"once","schedule_value":"2099-01-01T00:00:00Z"},"source_group":"test-group"}' > data/ipc/test-group/tasks/test-cmd.json

# Verify it's valid JSON
node -e "JSON.parse(require('fs').readFileSync('data/ipc/test-group/tasks/test-cmd.json','utf8')); console.log('OK')"

# Clean up
rm -rf data/ipc/test-group
```

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

Result: 14/14 passed, 1 skipped
```

If any non-SKIP check fails, the overall result is FAIL and the system is not ready.

## Verification

This skill IS the verification. If all 15 checks pass, the system is ready for `npm run dev`.
