---
disable-model-invocation: true
---

# /debug — Container Troubleshooting

Interactive troubleshooting guide for diagnosing container and agent-runner issues.

## When to use

Run `/debug` when:
- Containers fail to start or exit immediately
- Agent responses are empty or missing
- MCP tools don't work (schedule_task, send_message, etc.)
- Multi-turn conversations break
- Sentinel markers are not appearing in output
- Container builds fail

## Diagnostic steps

### Step 1: Check container runtime

```bash
docker info > /dev/null 2>&1 && echo "Docker OK" || echo "Docker NOT running"
docker image inspect mdclaw > /dev/null 2>&1 && echo "Image OK" || echo "Image NOT built"
```

If Docker is not running, start it. If image is not built:
```bash
docker build -t mdclaw -f container/Dockerfile .
```

### Step 2: Check agent-runner build

```bash
ls container/agent-runner/dist/index.js && echo "Built" || echo "NOT built"
```

If not built:
```bash
cd container/agent-runner && npm install && npm run build
```

### Step 3: Run container smoke test

```bash
bash test/container-test.sh
```

Expected output should contain:
- `---NANOCLAW_OUTPUT_START---`
- `---NANOCLAW_OUTPUT_END---`
- Clean exit (exit code 0)

### Step 4: Test with manual input

Run a container manually with a test prompt:

```bash
echo '{"prompt":"Say hello","sessionId":"test-123","groupFolder":"main","chatJid":"test@test","isMain":true,"isScheduledTask":false,"assistantName":"Andy","secrets":{"ANTHROPIC_API_KEY":"YOUR_KEY"}}' | docker run --rm -i mdclaw
```

Check:
- Does it produce output between sentinel markers?
- Are there errors on stderr?
- Does it exit cleanly?

### Step 5: Check MCP tools

If MCP tools aren't working, verify in the container:

```bash
docker run --rm -it --entrypoint /bin/bash mdclaw
# Inside container:
node -e "const {createMcpServer} = require('/agent-runner/dist/mcp-server.js'); console.log('MCP OK');"
```

### Step 6: Check IPC directories

```bash
ls -la data/ipc/
ls -la data/ipc/main/
ls -la data/ipc/main/input/
ls -la data/ipc/main/tasks/
```

IPC directories should exist and be writable.

### Step 7: Check logs

```bash
# Application logs
cat logs/mdclaw.log | tail -50

# Check for container errors
docker logs $(docker ps -lq --filter label=mdclaw) 2>&1 | tail -20
```

### Step 8: Check environment

```bash
# Verify .env has required vars
grep ANTHROPIC_API_KEY .env
grep STORE_DIR .env
grep DATA_DIR .env

# Verify secrets aren't in process.env
npx tsx -e "import './src/env.js'; console.log('ANTHROPIC_API_KEY' in process.env ? 'LEAK!' : 'OK');"
```

### Step 9: Check sessions

```bash
ls -la data/sessions/
ls -la data/sessions/main/.claude/
```

Session directories should exist. If missing, they'll be created on first container run.

### Step 10: Nuclear option — full rebuild

If nothing else works:

```bash
# Rebuild agent-runner
cd container/agent-runner && rm -rf node_modules dist && npm install && npm run build && cd ../..

# Rebuild Docker image
docker build --no-cache -t mdclaw -f container/Dockerfile .

# Rebuild host
rm -rf dist && npm run build

# Run smoke test
bash test/container-test.sh
```

## Common issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| Container exits immediately | Missing/invalid ContainerInput JSON | Check stdin piping |
| Empty output | API key not reaching SDK | Check secrets in ContainerInput |
| MCP tools not found | MCP server not wired | Verify `mcpServers` in queryOptions |
| Multi-turn breaks | Wrong session ID for resume | Check sdkSessionId capture |
| Timeout | Long-running agent or stuck | Increase `CONTAINER_TIMEOUT` |
| Permission denied | Container user mismatch | Check uid 1000 ownership on mounts |
| Build fails | Node modules stale | `rm -rf node_modules && npm install` |
