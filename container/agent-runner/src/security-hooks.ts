// mdclaw agent-runner: security hooks for Claude Agent SDK

const STRIPPED_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_API_KEY',
];

/**
 * Creates a hook that strips sensitive environment variables from
 * any Bash subprocess spawned by the Claude Agent SDK.
 * Returns the hook config object to pass to the SDK session.
 */
export function createSanitizeBashHook() {
  return {
    type: 'tool_use' as const,
    toolName: 'bash',
    hook: (_input: Record<string, unknown>, env: Record<string, string | undefined>) => {
      for (const key of STRIPPED_ENV_VARS) {
        delete env[key];
      }
      return { env };
    },
  };
}

/**
 * Sanitizes an environment object by removing sensitive keys.
 * Used when constructing the container process environment.
 */
export function sanitizeEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const cleaned = { ...env };
  for (const key of STRIPPED_ENV_VARS) {
    delete cleaned[key];
  }
  return cleaned;
}
