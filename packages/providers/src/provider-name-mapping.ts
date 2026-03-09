/**
 * Provider Name Mapping Utility
 *
 * Safely maps provider name strings to the Provider type.
 * Replaces unsafe `as Provider` casts throughout the codebase.
 */

import type { Provider } from '@tamma/cost-monitor';

/**
 * Set of all known provider identifiers.
 * Defined as ReadonlySet<string> with the initializer using Set<Provider>
 * to ensure all known Provider values are included at compile time.
 */
const KNOWN_PROVIDERS: ReadonlySet<string> = new Set<Provider>([
  'anthropic',
  'openai',
  'openrouter',
  'google',
  'local',
  'claude-code',
  'opencode',
  'z-ai',
  'zen-mcp',
]);

const DEFAULT_PROVIDER: Provider = 'claude-code';

/**
 * Map a provider name string to the Provider type safely.
 * Returns the validated Provider value or defaults to 'claude-code'
 * if the name is not recognized.
 *
 * Replaces unsafe `as Provider` casts throughout the codebase.
 *
 * @param name - The provider name string to validate
 * @returns A valid Provider value
 */
export function mapProviderName(name: string | undefined): Provider {
  if (name && KNOWN_PROVIDERS.has(name)) {
    return name as Provider;
  }
  return DEFAULT_PROVIDER;
}
