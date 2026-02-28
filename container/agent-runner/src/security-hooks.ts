// mdclaw agent-runner: security utilities for subprocess environment

import type { HookCallback, PreToolUseHookInput } from '@anthropic-ai/claude-code';

// Secrets that must not leak to bash subprocesses spawned by Claude.
// These are needed by the SDK for API auth but should never be visible
// to commands the agent runs.
const SECRET_ENV_VARS = ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'];

/**
 * Creates a PreToolUse hook that strips secret env vars from every Bash command.
 * Register with matcher 'Bash' so it only fires for bash tool invocations.
 *
 * Mechanism: prepends `unset KEY1 KEY2 ... 2>/dev/null;` to each command,
 * ensuring the shell subprocess cannot read API keys even though the SDK
 * process itself has them in its environment.
 */
export function createSanitizeBashHook(): HookCallback {
  return async (input) => {
    const preInput = input as PreToolUseHookInput;
    const command = (preInput.tool_input as { command?: string })?.command;
    if (!command) return {};

    const unsetPrefix = `unset ${SECRET_ENV_VARS.join(' ')} 2>/dev/null; `;
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse' as const,
        updatedInput: {
          ...(preInput.tool_input as Record<string, unknown>),
          command: unsetPrefix + command,
        },
      },
    };
  };
}
