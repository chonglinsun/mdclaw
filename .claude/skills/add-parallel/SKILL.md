---
disable-model-invocation: true
---

# /add-parallel — Parallel AI MCP Integration

Adds the Parallel AI MCP server to container sessions, giving agents access to web search, research, and real-time information retrieval tools.

## Prerequisites

- `src/container.ts` must exist (from `/add-containers`)
- Container must have network access for the MCP server to function (override `--network=none` for groups that need it)

## What this does

Parallel AI provides MCP tools for:
- **Web search** — search the web and get summarized results
- **Deep research** — multi-step research with source citations
- **URL fetch** — retrieve and parse web page content

These tools run as an MCP server inside the container, giving the agent direct access to current information.

## Files to modify

| File | Action |
|------|--------|
| `src/container.ts` | Add MCP server config to Claude settings |

## Behavioral requirements

### Container Claude settings

When writing `data/sessions/{groupFolder}/.claude/settings.json` (in `writeClaudeSettings()`), add the Parallel AI MCP server if `env.PARALLEL_API_KEY` is set:

```json
{
  "mcpServers": {
    "parallel": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/parallel-mcp-server"],
      "env": {
        "PARALLEL_API_KEY": "{env.PARALLEL_API_KEY}"
      }
    }
  }
}
```

### Network access

Groups that use Parallel AI need network access. Modify `runContainer()` to:
- Check if the group's container config has `network: true` or if `env.PARALLEL_API_KEY` is set
- If so, omit the `--network=none` flag (or use `--network=bridge`)

### Per-group opt-in

Not all groups need web search. The MCP server is only added to Claude settings for groups where:
- `env.PARALLEL_API_KEY` is set globally, AND
- The group's container config does not have `network: false`

## Env vars

```
PARALLEL_API_KEY=            # Parallel AI API key for web search
```

## Verification

```bash
npx tsc --noEmit
# Manual: run a container and verify the agent can use web search
```
