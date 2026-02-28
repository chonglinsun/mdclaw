---
disable-model-invocation: true
---

# /convert-to-apple-container — Docker to Apple Container Migration

Migrates an existing mdclaw installation from Docker to Apple Container runtime on macOS.

## Prerequisites

- macOS with Apple Container support (`container` binary available)
- mdclaw fully set up and working with Docker
- `.env` exists with `CONTAINER_RUNTIME=docker`

## Steps to perform

### Step 1: Verify Apple Container is available

```bash
which container && container --version
```

If not available, inform the user that Apple Container requires macOS 26+ or the appropriate Xcode tools.

### Step 2: Start the Apple Container daemon

```bash
container system start
```

### Step 3: Build the image with Apple Container

```bash
container build -t mdclaw -f container/Dockerfile .
```

If the build fails, common issues:
- `FROM` image not available — Apple Container may not support all base images
- Build context too large — check `.dockerignore`

### Step 4: Update environment

Edit `.env`:
```
CONTAINER_RUNTIME=apple-container
```

### Step 5: Test the container

Run a quick smoke test:
```bash
echo '{"prompt":"Say hello","sessionId":"test","groupFolder":"main","chatJid":"test","isMain":true,"isScheduledTask":false,"assistantName":"Andy","secrets":{}}' | container run --rm -i mdclaw
```

Verify sentinel markers appear in output.

### Step 6: Understand the differences

| Aspect | Docker | Apple Container |
|--------|--------|-----------------|
| Mount syntax | `-v /host:/container` | `--mount type=bind,src=/host,dst=/container` |
| Env vars with stdin | `-e KEY=VALUE` works | Buggy — secrets written to temp file mounted at `/secrets.json` |
| Daemon | Always running | Must call `container system start` |
| Image compatibility | Full OCI | Subset — some base images may not work |

The `AppleContainerRuntime` class in `src/container-runtime.ts` handles these differences automatically:
- Translates `-v` mounts to `--mount` syntax
- Collects `-e` vars into a temp JSON file mounted at `/secrets.json`
- The agent-runner reads `/secrets.json` as fallback when stdin secrets are empty

### Step 7: Verify full system

```bash
npx tsc --noEmit
npm run dev
```

Send a test message and verify the assistant responds.

### Rollback

To revert to Docker:
1. Edit `.env`: `CONTAINER_RUNTIME=docker`
2. Rebuild Docker image: `docker build -t mdclaw -f container/Dockerfile .`
3. Restart: `npm run dev`

## Verification

```bash
# Check runtime is detected
npx tsx -e "import { detectRuntime } from './src/container-runtime.js'; console.log(detectRuntime().constructor.name);"
# Should print: AppleContainerRuntime
```
