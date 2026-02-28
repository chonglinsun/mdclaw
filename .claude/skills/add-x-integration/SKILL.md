---
disable-model-invocation: true
---

# /add-x-integration — X/Twitter Integration

Adds X (Twitter) automation via browser automation inside containers. This is NOT a channel — it's an MCP tool suite available to agents for posting, liking, replying, retweeting, and quoting on X.

## Prerequisites

- Container Dockerfile must include Chromium (already present)
- `agent-browser` must be installed in container (already present)
- `container/agent-runner/src/mcp-server.ts` — MCP server to extend

## Approach

X integration uses browser automation rather than the X API (which has restrictive rate limits and requires paid access). The agent uses the `agent-browser` tool (already in the container) to interact with x.com directly.

## Files to create

| File | Purpose |
|------|---------|
| `container/skills/x-integration/SKILL.md` | Skill file for container-side agent |

## container/skills/x-integration/SKILL.md

This is a CLAUDE.md-style instruction file mounted into the container that teaches the agent how to use X via browser automation.

### Content:

The skill file should instruct the agent on:

1. **Authentication:**
   - Navigate to `https://x.com/login`
   - Use stored auth state from `/workspace/group/x-auth/` if available
   - If no stored state, log in with credentials from container secrets (`X_USERNAME`, `X_PASSWORD`)
   - Save auth state after successful login for reuse

2. **Available actions:**
   - **Post:** Navigate to compose, type content, submit
   - **Like:** Find tweet by URL or in timeline, click like button
   - **Reply:** Open tweet, click reply, type response, submit
   - **Retweet:** Find tweet, click retweet button
   - **Quote tweet:** Find tweet, click quote, add commentary, submit
   - **Search:** Use search bar, filter by Latest/Top/People
   - **Read timeline:** Scroll and extract tweets from home or user timeline
   - **Read notifications:** Check notification tab for mentions/replies

3. **Best practices:**
   - Wait for page loads between actions
   - Use semantic selectors (aria labels, data-testid attributes)
   - Handle rate limiting gracefully (back off if actions fail)
   - Keep posts within 280 character limit
   - Save screenshots on failure for debugging

4. **Env vars (passed as container secrets):**
   ```
   X_USERNAME=
   X_PASSWORD=
   ```

## Integration

The X integration is instruction-based, not code-based. The agent-runner already has `agent-browser` and Chromium. This skill teaches the agent HOW to use the browser for X actions.

To enable: place the skill file in the group's data directory or mount it into the container.

## Verification

Manual — run a container with X credentials and verify the agent can post a test tweet.
