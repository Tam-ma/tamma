/**
 * Configuration utilities for the Tamma platform.
 */

export { normalizeAgentsConfig } from './normalize-agents-config.js';

// Re-export validation functions from types for convenience.
// They live in types/agent-config.ts but are logically part of config validation.
export {
  validateAgentsConfig,
  validateSecurityConfig,
  validateProviderName,
  validateMaxBudgetUsd,
} from '../types/agent-config.js';
