---
disable-model-invocation: true
---

# /customize — Interactive Post-Setup Modification

Interactive skill for customizing a running mdclaw instance. Makes direct code edits rather than using a config layer — the codebase is small enough for Claude to understand fully.

## Prerequisites

The system must be set up and passing `/test`:

- All source files in `src/` generated
- `npm install` completed
- `npx tsc --noEmit` passes
- `.env` exists and is configured

## Context

This skill modifies an already-generated mdclaw instance. It presents categories, plans changes, implements them, and verifies type safety. All changes are direct source edits — no abstraction layer.

## Flow

### Phase 1: Ask

Present the user with modification categories:

1. **Name & trigger** — Change assistant name, trigger patterns
2. **Persona** — Edit personality files (IDENTITY.md, SOUL.md), group CLAUDE.md
3. **MCP integration** — Add external MCP servers to container sessions
4. **New channel** — Add Discord, Slack, Headless, or scaffold a custom channel
5. **Deployment** — Change runtime, limits, concurrency, timeouts

Ask which category (or categories) the user wants to customize.

### Phase 2: Plan

Based on the selection, identify which files need to change:

| Category | Files affected |
|----------|---------------|
| Name & trigger | `src/config.ts`, `.env`, `src/router.ts` (default trigger) |
| Persona | `data/{group}/IDENTITY.md`, `data/{group}/SOUL.md`, `data/{group}/CLAUDE.md` |
| MCP integration | `data/sessions/{group}/.claude/settings.json` |
| New channel | Run `/add-discord`, `/add-slack`, `/add-headless`, or scaffold custom |
| Deployment | `.env`, `src/config.ts` (constants) |

Present the plan to the user before making changes.

### Phase 3: Implement

Make targeted source edits based on the plan.

**Name & trigger:**
- Edit `ASSISTANT_NAME` in `.env`
- If the user wants a different default trigger pattern, edit the trigger regex in `src/message-processor.ts`
- Update any hardcoded references to the old name

**Persona:**
- Edit or create `data/{group}/IDENTITY.md` — who the assistant IS (name, role, personality traits)
- Edit or create `data/{group}/SOUL.md` — deep behavioral principles (values, communication style)
- Edit or create `data/{group}/CLAUDE.md` — task-specific instructions
- Template for IDENTITY.md:
  ```markdown
  # Identity

  You are [Name], a [role description].

  ## Personality
  - [trait 1]
  - [trait 2]
  ```
- Template for SOUL.md:
  ```markdown
  # Principles

  ## Communication
  - [style guideline]

  ## Values
  - [value 1]
  ```

**MCP integration:**
- Read the current `data/sessions/{group}/.claude/settings.json`
- Add new MCP server entry under `mcpServers`:
  ```json
  {
    "mcpServers": {
      "server-name": {
        "command": "npx",
        "args": ["-y", "@package/mcp-server"],
        "env": {}
      }
    }
  }
  ```
- Ask the user for: server name, command, args, and any env vars

**New channel:**
- If the user picks Discord: run `/add-discord` skill
- If the user picks Slack: run `/add-slack` skill
- If the user picks Headless: run `/add-headless` skill
- If custom: scaffold a new channel file from the `Channel` interface template and guide the user through implementation

**Deployment:**
- Edit `.env` for runtime changes:
  - `CONTAINER_RUNTIME` → `docker` or `apple-container`
  - `CONTAINER_IMAGE` → custom image name
- Edit `src/config.ts` for limit changes:
  - `MAX_CONCURRENT_CONTAINERS` — concurrency limit
  - `CONTAINER_TIMEOUT` — max execution time
  - `IDLE_TIMEOUT` — idle timeout
  - `POLL_INTERVAL` — message polling frequency

### Phase 4: Verify

After any code changes:

```bash
npx tsc --noEmit
```

Must pass with zero errors. If it fails, fix the type errors immediately.

If tests exist for the modified area:

```bash
npx vitest run
```

## Error handling

- If a category requires files that don't exist, create them
- If the user's changes would break type safety, warn and suggest alternatives
- Always verify with `npx tsc --noEmit` before finishing
- If verification fails, fix the issues — don't leave the user with broken code

## Verification

```bash
# After customization
npx tsc --noEmit
npx vitest run
```
