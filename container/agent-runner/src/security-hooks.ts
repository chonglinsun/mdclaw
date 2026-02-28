// mdclaw agent-runner: security utilities for subprocess environment

const STRIPPED_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_API_KEY',
];

/**
 * Sanitizes an environment object by removing sensitive keys.
 * Pass the result to `query()` via `options.env` to ensure
 * bash subprocesses spawned by Claude don't inherit API keys.
 */
export function sanitizeEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const cleaned = { ...env };
  for (const key of STRIPPED_ENV_VARS) {
    delete cleaned[key];
  }
  return cleaned;
}
