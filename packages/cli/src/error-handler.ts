import { TammaError } from '@tamma/shared';

export interface FormattedError {
  message: string;
  suggestions: string[];
}

const SUGGESTION_MAP: Record<string, string[]> = {
  ENGINE_ERROR: [
    'Check ANTHROPIC_API_KEY is set and valid',
    'Verify Claude CLI is installed (npm i -g @anthropic-ai/claude-code)',
    'Run with --verbose for details',
  ],
  WORKFLOW_ERROR: [
    'Check repository access permissions',
    'Verify branch permissions allow push',
    'Issue may be in an invalid state — check GitHub',
  ],
  CONFIGURATION_ERROR: [
    'Run `tamma init` to recreate config',
    'Check environment variables (GITHUB_TOKEN, TAMMA_GITHUB_OWNER, etc.)',
    'Verify tamma.config.json is valid JSON',
  ],
  PLATFORM_ERROR: [
    'Verify GitHub token has required permissions (repo scope)',
    'Check repository access — token may lack access to this repo',
    'Token may be expired — regenerate at github.com/settings/tokens',
  ],
};

const DEFAULT_SUGGESTIONS = [
  'Run with --verbose for details',
  'Check your internet connection',
  'Report issues at https://github.com/Tam-ma/tamma/issues',
];

export function formatErrorWithSuggestions(error: unknown): FormattedError {
  const message = error instanceof Error ? error.message : String(error);

  if (error instanceof TammaError) {
    const suggestions = SUGGESTION_MAP[error.code];
    if (suggestions !== undefined) {
      return { message, suggestions };
    }
  }

  return { message, suggestions: DEFAULT_SUGGESTIONS };
}
