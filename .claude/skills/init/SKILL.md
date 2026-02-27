---
disable-model-invocation: true
---

# /init — Project Scaffold

> **Note:** This skill is called automatically by `/setup`. You only need to run it individually if you want to generate the project scaffold separately for customization.

Generates the project skeleton: package.json, tsconfig.json, directory structure, and dev tooling.

## Prerequisites

None — this is the first skill to run.

## Context

This skill creates the bare Node.js + TypeScript project that all subsequent skills build on. It does not generate any application code — only project configuration and empty directories.

## Files to create

| File | Purpose |
|------|---------|
| `package.json` | Dependencies, scripts, metadata |
| `tsconfig.json` | TypeScript compiler configuration |
| `vitest.config.ts` | Test runner configuration |
| `src/` | Empty directory for generated application code |
| `.env.example` | Template for required environment variables |

## package.json specification

```json
{
  "name": "mdclaw",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  }
}
```

### Exact dependencies

```json
{
  "dependencies": {
    "@anthropic-ai/claude-code": "^1.0.0",
    "@whiskeysockets/baileys": "^7.0.0-rc.9",
    "better-sqlite3": "^11.7.0",
    "cron-parser": "^4.9.0",
    "dotenv": "^16.4.7",
    "grammy": "^1.39.3",
    "pino": "^9.6.0",
    "pino-pretty": "^13.0.0",
    "qrcode-terminal": "^0.12.0",
    "yaml": "^2.7.0",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "@types/node": "^22.10.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

## tsconfig.json specification

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

## vitest.config.ts specification

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
```

## .env.example contents

```
# Required
STORE_DIR=./store
DATA_DIR=./data
MAIN_GROUP_FOLDER=main

# WhatsApp (required if using WhatsApp channel)
# No env vars needed — auth is via QR code

# Telegram (required if using Telegram channel)
TELEGRAM_BOT_TOKEN=
TELEGRAM_ONLY=false

# Optional
LOG_LEVEL=info
CONTAINER_RUNTIME=docker
```

## Behavioral requirements

1. Create the `src/` directory (empty — other skills populate it)
2. Create the `store/` and `data/` directories with `.gitkeep` files
3. Do NOT run `npm install` — the user will do that after reviewing
4. Write each file exactly as specified above — no additions or modifications

## Verification

After running this skill:

```bash
# Files exist
ls package.json tsconfig.json vitest.config.ts .env.example
ls src/ store/ data/

# Valid JSON
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"
node -e "JSON.parse(require('fs').readFileSync('tsconfig.json','utf8'))"
```
