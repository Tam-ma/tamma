/**
 * Content sanitization for LLM prompt inputs and outputs.
 *
 * Provides defense-in-depth against prompt injection, HTML injection,
 * invisible Unicode character attacks (including CVE-2021-42574 bidi overrides),
 * and null byte injection.
 *
 * IMPORTANT: The prompt injection detection is heuristic-based and does NOT
 * guarantee detection of all injection attempts. It is one layer of a
 * defense-in-depth strategy. Detected patterns are reported as warnings
 * in the return value — they do NOT block execution.
 *
 * @module
 */

import type { ILogger } from '../contracts/index.js';

/**
 * Interface for content sanitization.
 * Extracted for Dependency Inversion Principle (DIP) consistency with
 * IProviderHealthTracker (9-3), IAgentProviderFactory (9-4),
 * IProviderChain (9-5), IAgentPromptRegistry (9-6).
 */
export interface IContentSanitizer {
  /**
   * Sanitize input content before it reaches the LLM.
   * Strips HTML, removes zero-width characters, detects prompt injection patterns.
   * Never throws -- returns warnings for anything suspicious.
   */
  sanitize(input: string): { result: string; warnings: string[] };

  /**
   * Sanitize output content coming back from the LLM.
   * Strips any HTML outside code blocks, removes zero-width chars.
   * Less aggressive than input sanitization.
   * Never throws -- returns warnings for anything suspicious.
   */
  sanitizeOutput(output: string): { result: string; warnings: string[] };
}

/**
 * Configuration options for ContentSanitizer.
 */
export interface ContentSanitizerOptions {
  /** When false, sanitize() returns input unchanged (still removes null bytes). Default: true */
  enabled?: boolean;
  /** Additional injection patterns beyond built-in defaults (additive, not replacement) */
  extraInjectionPatterns?: readonly string[];
  /** Logger for warnings */
  logger?: ILogger;
}

/**
 * Regular expression matching zero-width and invisible Unicode characters.
 *
 * Covers 20+ code points:
 * - U+0000       Null byte
 * - U+00AD       Soft hyphen
 * - U+034F       Combining grapheme joiner
 * - U+200B       Zero-width space
 * - U+200C       Zero-width non-joiner
 * - U+200D       Zero-width joiner
 * - U+200E       Left-to-right mark
 * - U+200F       Right-to-left mark
 * - U+202A       Left-to-right embedding
 * - U+202B       Right-to-left embedding
 * - U+202C       Pop directional formatting
 * - U+202D       Left-to-right override
 * - U+202E       Right-to-left override (CVE-2021-42574)
 * - U+2028       Line separator
 * - U+2029       Paragraph separator
 * - U+2060       Word joiner
 * - U+2061       Function application
 * - U+2062       Invisible times
 * - U+2063       Invisible separator
 * - U+2064       Invisible plus
 * - U+2066       Left-to-right isolate
 * - U+2067       Right-to-left isolate
 * - U+2068       First strong isolate
 * - U+2069       Pop directional isolate
 * - U+FEFF       Byte order mark (BOM)
 * - U+FFFC       Object replacement character
 */
// eslint-disable-next-line no-control-regex
const ZERO_WIDTH_CHARS_RE = /[\u0000\u00AD\u034F\u200B-\u200F\u202A-\u202E\u2028\u2029\u2060-\u2064\u2066-\u2069\uFEFF\uFFFC]/g;

/**
 * Built-in prompt injection detection patterns organized by category.
 *
 * IMPORTANT: These are heuristic patterns for defense-in-depth.
 * They will produce false positives on benign input that coincidentally
 * matches. The warnings inform the caller; they do not block execution.
 *
 * Each entry is [category, pattern_string] where pattern_string is matched
 * as a case-insensitive substring against NFKD-normalized input.
 */
const BUILTIN_INJECTION_PATTERNS: ReadonlyArray<readonly [string, string]> = [
  // Category 1: Instruction override
  ['instruction_override', 'ignore previous instructions'],
  ['instruction_override', 'ignore all previous instructions'],
  ['instruction_override', 'ignore the above'],
  ['instruction_override', 'disregard above'],
  ['instruction_override', 'disregard previous'],
  ['instruction_override', 'forget your instructions'],
  ['instruction_override', 'forget all instructions'],
  ['instruction_override', 'override your instructions'],
  ['instruction_override', 'new instructions:'],
  ['instruction_override', 'ignore prior instructions'],

  // Category 2: Role hijacking
  ['role_hijacking', 'you are now'],
  ['role_hijacking', 'act as'],
  ['role_hijacking', 'pretend to be'],
  ['role_hijacking', 'roleplay as'],
  ['role_hijacking', 'simulate being'],
  ['role_hijacking', 'behave as'],
  ['role_hijacking', 'assume the role'],
  ['role_hijacking', 'switch to'],
  ['role_hijacking', 'you must now act'],

  // Category 3: System prompt extraction
  ['system_prompt_extraction', 'repeat your system prompt'],
  ['system_prompt_extraction', 'what are your instructions'],
  ['system_prompt_extraction', 'show me your prompt'],
  ['system_prompt_extraction', 'reveal your system'],
  ['system_prompt_extraction', 'display your instructions'],
  ['system_prompt_extraction', 'print your system prompt'],
  ['system_prompt_extraction', 'output your instructions'],
  ['system_prompt_extraction', 'what is your system prompt'],

  // Category 4: Delimiter injection
  ['delimiter_injection', '```system'],
  ['delimiter_injection', '###system###'],
  ['delimiter_injection', '[inst]'],
  ['delimiter_injection', '[/inst]'],
  ['delimiter_injection', '<<sys>>'],
  ['delimiter_injection', '<|system|>'],
  ['delimiter_injection', '<|im_start|>'],
  ['delimiter_injection', '<|im_end|>'],
  ['delimiter_injection', 'system: override'],
  ['delimiter_injection', '### instruction ###'],
];

/**
 * Category labels for human-readable warning messages.
 */
const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  instruction_override: 'Instruction override attempt',
  role_hijacking: 'Role hijacking attempt',
  system_prompt_extraction: 'System prompt extraction attempt',
  delimiter_injection: 'Delimiter injection attempt',
  encoding_evasion: 'Encoding evasion attempt',
  custom: 'Custom pattern match',
};

/**
 * Content sanitizer class implementing IContentSanitizer.
 *
 * Holds configuration state (ContentSanitizerOptions) and is designed to be
 * held as an instance by SecureAgentProvider.
 *
 * Pipeline for sanitize():
 *   1. Null byte removal (always, even when disabled)
 *   2. If enabled: stripHtml -> removeZeroWidthChars -> detectPromptInjection
 *
 * Pipeline for sanitizeOutput():
 *   1. Null byte removal (always, even when disabled)
 *   2. If enabled: removeZeroWidthChars -> stripHtmlPreserveCode
 */
export class ContentSanitizer implements IContentSanitizer {
  private readonly _enabled: boolean;
  private readonly _extraInjectionPatterns: readonly string[];
  private readonly _logger: ILogger | undefined;

  constructor(options?: ContentSanitizerOptions) {
    this._enabled = options?.enabled !== false;
    this._extraInjectionPatterns = options?.extraInjectionPatterns ?? [];
    this._logger = options?.logger;
  }

  /**
   * Sanitize input content before it reaches the LLM.
   * Strips HTML, removes zero-width characters, detects prompt injection patterns.
   * Never throws -- returns warnings for anything suspicious.
   *
   * When options.enabled === false: still removes null bytes (hard safety requirement)
   * but skips HTML stripping and injection detection.
   */
  sanitize(input: string): { result: string; warnings: string[] } {
    try {
      const warnings: string[] = [];
      let result = input;

      // Null byte removal is always applied (hard safety requirement)
      result = result.replace(/\0/g, '');

      if (!this._enabled) {
        return { result, warnings };
      }

      const preHtml = result;
      result = this._stripHtml(result);
      if (result !== preHtml) {
        warnings.push('HTML content was stripped from input');
      }
      result = this._removeZeroWidthChars(result);

      const injectionWarnings = this._detectPromptInjection(result);
      warnings.push(...injectionWarnings);

      if (warnings.length > 0 && this._logger) {
        this._logger.warn('Content sanitization warnings detected', {
          warningCount: warnings.length,
          warnings,
        });
      }

      return { result, warnings };
    } catch {
      // Never throw -- return input with null bytes removed as best-effort
      return { result: input.replace(/\0/g, ''), warnings: [] };
    }
  }

  /**
   * Sanitize output content coming back from the LLM.
   * Strips any HTML outside code blocks, removes zero-width chars.
   * Less aggressive than input sanitization.
   * Never throws -- returns warnings for anything suspicious.
   *
   * When options.enabled === false: still removes null bytes but skips HTML stripping.
   */
  sanitizeOutput(output: string): { result: string; warnings: string[] } {
    try {
      const warnings: string[] = [];
      let result = output;

      // Null byte removal is always applied
      result = result.replace(/\0/g, '');

      if (!this._enabled) {
        return { result, warnings };
      }

      result = this._removeZeroWidthChars(result);
      // Lighter-touch on output: strip HTML tags but preserve code blocks
      result = this._stripHtmlPreserveCode(result);

      return { result, warnings };
    } catch {
      // Never throw -- return output with null bytes removed as best-effort
      return { result: output.replace(/\0/g, ''), warnings: [] };
    }
  }

  /**
   * Quote-aware state machine: handles `<div title="a>b">content</div>` correctly
   * by tracking single/double quote state inside tag attributes.
   *
   * NOT regex-based, NOT simple indexOf for closing >.
   * The state machine tracks:
   * - Outside tag: accumulate text
   * - Inside tag: track quote state to find actual closing >
   */
  private _stripHtml(input: string): string {
    let result = '';
    let i = 0;
    while (i < input.length) {
      const start = input.indexOf('<', i);
      if (start === -1) {
        result += input.slice(i);
        break;
      }
      result += input.slice(i, start);
      // Find closing >, respecting quoted attributes
      let j = start + 1;
      let inSingle = false;
      let inDouble = false;
      while (j < input.length) {
        const ch = input[j]!;
        if (ch === '"' && !inSingle) {
          inDouble = !inDouble;
        } else if (ch === "'" && !inDouble) {
          inSingle = !inSingle;
        } else if (ch === '>' && !inSingle && !inDouble) {
          break;
        }
        j++;
      }
      // Handle unclosed tag: if no > found, strip from < to end
      i = j < input.length ? j + 1 : input.length;
    }
    return result;
  }

  /**
   * Strip HTML tags from content while preserving content within ``` code blocks.
   *
   * Splits input on triple-backtick boundaries and only strips HTML
   * in non-code segments. Code blocks are preserved verbatim.
   */
  private _stripHtmlPreserveCode(input: string): string {
    const delimiter = '```';
    const segments = input.split(delimiter);
    const result: string[] = [];

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]!;
      if (i % 2 === 0) {
        // Outside code block -- strip HTML
        result.push(this._stripHtml(segment));
      } else {
        // Inside code block -- preserve verbatim with delimiters
        result.push(delimiter + segment + delimiter);
      }
    }

    return result.join('');
  }

  /**
   * Removes zero-width and invisible characters (20+ code points).
   *
   * Covers:
   * - U+200B-U+200F (zero-width space, non-joiner, joiner, directional marks)
   * - U+202A-U+202E (bidi overrides -- trojan-source CVE-2021-42574)
   * - U+2060-U+2064 (word joiner, invisible operators)
   * - U+2066-U+2069 (bidi isolates)
   * - U+00AD (soft hyphen)
   * - U+034F (combining grapheme joiner)
   * - U+0000 (null byte)
   * - U+2028, U+2029 (line/paragraph separators)
   * - U+FEFF (BOM)
   * - U+FFFC (object replacement character)
   */
  private _removeZeroWidthChars(input: string): string {
    return input.replace(ZERO_WIDTH_CHARS_RE, '');
  }

  /**
   * Prompt injection detection with 5 categories:
   * 1. Instruction override: "ignore previous instructions", "disregard above"
   * 2. Role hijacking: "you are now", "act as", "pretend to be"
   * 3. System prompt extraction: "repeat your system prompt", "what are your instructions"
   * 4. Delimiter injection: "```system", "###SYSTEM###", "[INST]"
   * 5. Encoding evasion: detected via Unicode NFKD normalization before matching
   *
   * IMPORTANT: Patterns are heuristic defense-in-depth, not a guarantee.
   * Returns array of warning strings describing each detected pattern.
   *
   * Applies NFKD normalization before pattern matching to catch attempts
   * to bypass detection using compatibility characters (e.g., fullwidth Latin).
   *
   * Uses built-in patterns + options.extraInjectionPatterns (additive).
   */
  private _detectPromptInjection(input: string): string[] {
    const warnings: string[] = [];

    // Apply NFKD normalization to defeat encoding evasion
    // (e.g., fullwidth Latin letters like \uFF49\uFF47\uFF4E\uFF4F\uFF52\uFF45 -> "ignore")
    const normalized = input.normalize('NFKD');
    const lowered = normalized.toLowerCase();

    // Check if normalization changed the input (potential encoding evasion)
    const originalLowered = input.toLowerCase();
    if (lowered !== originalLowered) {
      // The input contained compatibility characters that normalized differently.
      // This may indicate an encoding evasion attempt.
      // We still run pattern matching on the normalized form.
      // Check if the normalized form triggers any pattern that the original would not.
      let evasionDetected = false;
      for (const [, pattern] of BUILTIN_INJECTION_PATTERNS) {
        if (lowered.includes(pattern) && !originalLowered.includes(pattern)) {
          evasionDetected = true;
          break;
        }
      }
      if (evasionDetected) {
        const label = CATEGORY_LABELS['encoding_evasion'] ?? 'Encoding evasion attempt';
        warnings.push(
          `${label}: Unicode compatibility characters detected that normalize to injection pattern`
        );
      }
    }

    // Check built-in patterns against normalized input
    for (const [category, pattern] of BUILTIN_INJECTION_PATTERNS) {
      if (lowered.includes(pattern)) {
        const label = CATEGORY_LABELS[category] ?? `Unknown category: ${category}`;
        warnings.push(`${label}: matched pattern "${pattern}"`);
      }
    }

    // Check extra patterns (additive to built-in defaults)
    for (const pattern of this._extraInjectionPatterns) {
      if (lowered.includes(pattern.toLowerCase())) {
        const label = CATEGORY_LABELS['custom'] ?? 'Custom pattern match';
        warnings.push(`${label}: matched pattern "${pattern}"`);
      }
    }

    return warnings;
  }
}
