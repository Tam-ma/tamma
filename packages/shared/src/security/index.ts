/**
 * Security primitives for the Tamma platform.
 *
 * Provides content sanitization, URL validation, action gating,
 * and secure fetch utilities.
 *
 * @module
 */

export type { IContentSanitizer, ContentSanitizerOptions } from './content-sanitizer.js';
export { ContentSanitizer } from './content-sanitizer.js';

export { isPrivateHost, validateUrl } from './url-validator.js';

export type { ActionGateOptions, ActionEvaluation } from './action-gating.js';
export { DEFAULT_BLOCKED_COMMANDS, evaluateAction } from './action-gating.js';
