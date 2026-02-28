---
disable-model-invocation: true
---

# /get-qodo-rules — Coding Rules Management

Fetches and manages coding rules for the project. Coding rules define patterns, conventions, and best practices that should be followed when generating or modifying code.

## What this does

1. Reads existing coding rules from `.qodo/rules.yaml` if present
2. Analyzes the codebase to extract implicit conventions:
   - Import patterns (ESM, relative paths, `.js` extensions)
   - Naming conventions (camelCase functions, PascalCase types)
   - Error handling patterns (try/catch, error types)
   - Logging patterns (pino, no console.log)
   - Testing patterns (vitest, describe/it)
3. Presents rules for review and editing
4. Writes updated rules to `.qodo/rules.yaml`

## Rules format

```yaml
version: 1
rules:
  - id: esm-imports
    description: Use ES module imports with .js extensions
    pattern: "import { X } from './module.js'"
    severity: error

  - id: no-console
    description: Use pino logger instead of console.log
    pattern: "logger.info() instead of console.log()"
    severity: error

  - id: sync-sqlite
    description: Use better-sqlite3 synchronous API
    pattern: "db.prepare().run() not await db.query()"
    severity: error

  - id: no-dotenv
    description: Never use dotenv.config()
    pattern: "Custom env parser in src/env.ts"
    severity: error

  - id: secrets-isolation
    description: Secrets stay in env object only
    pattern: "env.ANTHROPIC_API_KEY, never process.env.ANTHROPIC_API_KEY"
    severity: error
```

## Verification

Rules are informational — no build or test step needed.
