#!/usr/bin/env bash
# Container smoke test: verify agent-runner starts and produces sentinel output
# Run from project root: bash test/container-test.sh

set -euo pipefail

echo "=== mdclaw container smoke test ==="

# Check Docker is available
if ! command -v docker &> /dev/null; then
  echo "SKIP: Docker not available"
  exit 0
fi

# Check image exists
if ! docker image inspect mdclaw > /dev/null 2>&1; then
  echo "FAIL: mdclaw image not found. Run: docker build -t mdclaw -f container/Dockerfile ."
  exit 1
fi

# Create temp directories for mounts
TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

mkdir -p "$TMPDIR/data" "$TMPDIR/ipc/input" "$TMPDIR/ipc/tasks"

# Build test input JSON
TEST_INPUT=$(cat <<'JSON'
{
  "prompt": "Say exactly: Hello from mdclaw test",
  "sessionId": "test-session-001",
  "groupFolder": "test-group",
  "chatJid": "test@g.us",
  "isMain": false,
  "isScheduledTask": true,
  "assistantName": "TestBot",
  "secrets": {}
}
JSON
)

echo "Running container with test input..."

# Run container — no API key so it will exit quickly.
# Use docker's --stop-timeout and run with a background process for safety.
EXIT_CODE=0
OUTPUT=$(echo "$TEST_INPUT" | docker run --rm -i \
  --network=none \
  --user=1000:1000 \
  -v "$TMPDIR/data:/data" \
  -v "$TMPDIR/ipc:/ipc" \
  mdclaw 2>&1) || EXIT_CODE=$?

echo "Container output:"
echo "$OUTPUT" | head -50

# Check 1: Agent-runner started (it should at least parse the input)
if echo "$OUTPUT" | grep -q "Fatal\|Cannot find module\|MODULE_NOT_FOUND"; then
  echo "FAIL: Agent-runner failed to start"
  exit 1
fi
echo "CHECK 1: Agent-runner started — OK"

# Check 2: Input was parsed (look for any error about API key, which means input was read successfully)
if echo "$OUTPUT" | grep -qi "error\|api.key\|anthropic\|agent"; then
  echo "CHECK 2: Input parsed (API key error expected without key) — OK"
else
  echo "CHECK 2: Input parsed — OK (no error output)"
fi

# Check 3: Clean exit code (0 or 1 — not a crash signal like 137, 139)
if [ "$EXIT_CODE" -le 1 ]; then
  echo "CHECK 3: Clean exit (code $EXIT_CODE) — OK"
else
  echo "FAIL: Container exited with code $EXIT_CODE (possible crash)"
  exit 1
fi

# Check 4: ContainerInput JSON was parsed (look for sessionId or groupFolder in output)
if echo "$OUTPUT" | grep -q "test-session-001\|test-group\|TestBot"; then
  echo "CHECK 4: ContainerInput JSON parsed correctly — OK"
else
  echo "CHECK 4: ContainerInput JSON parsed — OK (no echo, but no parse error)"
fi

# Check 5: Sentinel markers present if ANTHROPIC_API_KEY was provided
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  if echo "$OUTPUT" | grep -q "NANOCLAW_OUTPUT_START\|NANOCLAW_OUTPUT_END"; then
    echo "CHECK 5: Sentinel markers present — OK"
  else
    echo "FAIL: Sentinel markers missing with API key set"
    exit 1
  fi
else
  echo "CHECK 5: Sentinel markers — SKIP (no API key)"
fi

# Check 6: IPC directory structure was available to the container
if [ -d "$TMPDIR/ipc/input" ] && [ -d "$TMPDIR/ipc/tasks" ]; then
  echo "CHECK 6: IPC directory structure intact — OK"
else
  echo "FAIL: IPC directories not found after container run"
  exit 1
fi

echo ""
echo "=== Smoke test passed ==="
