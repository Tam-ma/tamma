/**
 * Command pattern matching for shell commands
 * @module @tamma/gates/permissions/matchers/command-matcher
 */

export interface CommandMatchResult {
  matches: boolean;
  matchedPattern?: string;
  matchedBy: 'exact' | 'wildcard' | 'regex' | 'none';
}

/**
 * Match a string against a wildcard pattern without using regex.
 * Supports '*' as a glob that matches any sequence of characters.
 * Uses a greedy algorithm with backtracking bounded by segment count.
 */
function wildcardMatch(pattern: string, text: string): boolean {
  // Split pattern by '*' to get literal segments that must appear in order
  const segments = pattern.split('*');

  // No wildcards at all: must be exact match
  if (segments.length === 1) {
    return pattern.toLowerCase() === text.toLowerCase();
  }

  let pos = 0;
  const lowerText = text.toLowerCase();

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!.toLowerCase();

    if (segment.length === 0) {
      // Empty segment from leading/trailing/consecutive '*' - skip
      continue;
    }

    if (i === 0) {
      // First segment must be a prefix (pattern doesn't start with *)
      if (!lowerText.startsWith(segment)) return false;
      pos = segment.length;
    } else if (i === segments.length - 1) {
      // Last segment must be a suffix (pattern doesn't end with *)
      if (!lowerText.endsWith(segment)) return false;
      // Make sure suffix doesn't overlap with already-matched prefix
      if (lowerText.length - segment.length < pos) return false;
    } else {
      // Middle segment: find next occurrence after current pos
      const idx = lowerText.indexOf(segment, pos);
      if (idx === -1) return false;
      pos = idx + segment.length;
    }
  }

  return true;
}

/**
 * Test a user-provided regex-like pattern against text without using RegExp.
 * Supports a safe subset of regex syntax commonly used for command matching:
 * - ^ (start anchor)
 * - $ (end anchor)
 * - \s, \s+ (whitespace matching)
 * - \b (word boundary)
 * - (a|b) alternation groups
 * - Literal characters (case-insensitive)
 *
 * Falls back to literal case-insensitive substring matching for patterns
 * that use unsupported features.
 */
function safeRegexTest(pattern: string, text: string): boolean {
  // Reject excessively long patterns
  if (pattern.length > 200) return false;

  // Try to match using our safe subset interpreter
  const result = safePatternMatch(pattern, text.toLowerCase());
  if (result !== null) return result;

  // Fallback: literal case-insensitive substring match
  return text.toLowerCase().includes(pattern.toLowerCase());
}

/**
 * Attempt to match a pattern using a safe interpreter.
 * Returns true/false if the pattern is supported, or null if it uses
 * unsupported features (caller should fall back to literal match).
 */
function safePatternMatch(pattern: string, text: string): boolean | null {
  let mustAnchorStart = false;
  let mustAnchorEnd = false;
  let pos = 0;

  // Check for start anchor
  if (pattern.startsWith('^')) {
    mustAnchorStart = true;
    pos = 1;
  }

  // Check for end anchor
  if (pattern.endsWith('$') && !pattern.endsWith('\\$')) {
    mustAnchorEnd = true;
  }

  const endPos = mustAnchorEnd ? pattern.length - 1 : pattern.length;

  // Parse the pattern into tokens
  const tokens = parsePatternTokens(pattern, pos, endPos);
  if (tokens === null) return null; // Unsupported pattern

  if (mustAnchorStart) {
    // Must match from the beginning
    const matchLen = matchTokens(tokens, text, 0);
    if (matchLen === -1) return false;
    if (mustAnchorEnd && matchLen !== text.length) return false;
    return true;
  }

  // Try matching at every position
  for (let i = 0; i <= text.length; i++) {
    const matchLen = matchTokens(tokens, text, i);
    if (matchLen !== -1) {
      if (mustAnchorEnd && i + matchLen !== text.length) continue;
      return true;
    }
  }
  return false;
}

/** Token types for our safe pattern interpreter */
type PatternToken =
  | { type: 'literal'; char: string }
  | { type: 'whitespace_one' }     // \s (single whitespace)
  | { type: 'whitespace_plus' }    // \s+ (one or more whitespace)
  | { type: 'word_boundary' }      // \b
  | { type: 'alternation'; options: string[] }; // (a|b|c)

/**
 * Parse a pattern substring into tokens.
 * Returns null if the pattern uses unsupported regex features.
 */
function parsePatternTokens(pattern: string, start: number, end: number): PatternToken[] | null {
  const tokens: PatternToken[] = [];
  let i = start;

  while (i < end) {
    const ch = pattern[i]!;

    if (ch === '\\') {
      // Escape sequence
      const next = pattern[i + 1];
      if (next === 's') {
        // Check for \s+
        if (pattern[i + 2] === '+') {
          tokens.push({ type: 'whitespace_plus' });
          i += 3;
        } else {
          tokens.push({ type: 'whitespace_one' });
          i += 2;
        }
      } else if (next === 'b') {
        tokens.push({ type: 'word_boundary' });
        i += 2;
      } else if (next !== undefined) {
        // Escaped literal character (e.g., \., \-, \/)
        tokens.push({ type: 'literal', char: next.toLowerCase() });
        i += 2;
      } else {
        return null; // Trailing backslash
      }
    } else if (ch === '(') {
      // Parse alternation group (a|b|c)
      const closeIdx = pattern.indexOf(')', i + 1);
      if (closeIdx === -1 || closeIdx > end) return null;
      const groupContent = pattern.slice(i + 1, closeIdx);
      // Only support simple alternation (no nested groups or quantifiers)
      if (groupContent.includes('(') || groupContent.includes(')')) return null;
      const options = groupContent.split('|').map((o) => o.toLowerCase());
      tokens.push({ type: 'alternation', options });
      // Check for quantifier after group - not supported
      if (closeIdx + 1 < end && '+*?{'.includes(pattern[closeIdx + 1]!)) return null;
      i = closeIdx + 1;
    } else if ('+*?{[.'.includes(ch)) {
      // Unsupported regex metacharacter
      return null;
    } else {
      tokens.push({ type: 'literal', char: ch.toLowerCase() });
      i++;
    }
  }

  return tokens;
}

/**
 * Try to match tokens against text starting at position.
 * Returns the number of characters consumed, or -1 if no match.
 */
function matchTokens(tokens: PatternToken[], text: string, startPos: number): number {
  let pos = startPos;

  for (const token of tokens) {
    switch (token.type) {
      case 'literal':
        if (pos >= text.length || text[pos] !== token.char) return -1;
        pos++;
        break;

      case 'whitespace_one':
        if (pos >= text.length || !' \t\n\r\f\v'.includes(text[pos]!)) return -1;
        pos++;
        break;

      case 'whitespace_plus': {
        if (pos >= text.length || !' \t\n\r\f\v'.includes(text[pos]!)) return -1;
        pos++;
        // Consume additional whitespace greedily
        while (pos < text.length && ' \t\n\r\f\v'.includes(text[pos]!)) pos++;
        break;
      }

      case 'word_boundary': {
        const prevIsWord = pos > 0 && isWordChar(text[pos - 1]!);
        const nextIsWord = pos < text.length && isWordChar(text[pos]!);
        if (prevIsWord === nextIsWord) return -1; // Not a boundary
        break;
      }

      case 'alternation': {
        let matched = false;
        for (const option of token.options) {
          if (text.startsWith(option, pos)) {
            pos += option.length;
            matched = true;
            break;
          }
        }
        if (!matched) return -1;
        break;
      }
    }
  }

  return pos - startPos;
}

/** Check if a character is a "word" character (alphanumeric or underscore) */
function isWordChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||   // 0-9
    (code >= 65 && code <= 90) ||   // A-Z
    (code >= 97 && code <= 122) ||  // a-z
    code === 95                      // _
  );
}

/**
 * Wrapper around a user-provided regex pattern for matching.
 * Stores the original pattern string for display purposes.
 */
interface PatternMatcher {
  test: (text: string) => boolean;
  source: string;
  type: 'wildcard' | 'regex';
}

/**
 * Matcher for shell command patterns
 * Supports:
 * - Exact matches: 'npm test'
 * - Wildcard patterns: 'npm run *', 'git *'
 * - Regex patterns: '^npm\s+test'
 */
export class CommandMatcher {
  private readonly allowedExact: string[];
  private readonly deniedExact: string[];
  private readonly allowedPatterns: PatternMatcher[];
  private readonly deniedPatterns: PatternMatcher[];

  constructor(
    allowedCommands: string[] = [],
    deniedCommands: string[] = [],
    allowedPatterns: string[] = [],
    deniedPatterns: string[] = [],
  ) {
    this.allowedExact = allowedCommands.filter((c) => !c.includes('*'));
    this.deniedExact = deniedCommands.filter((c) => !c.includes('*'));

    // Convert wildcard commands to pattern matchers (no regex involved)
    const allowedWildcards: PatternMatcher[] = allowedCommands
      .filter((c) => c.includes('*'))
      .map((c) => ({
        test: (text: string) => wildcardMatch(c, text),
        source: c,
        type: 'wildcard' as const,
      }));
    const deniedWildcards: PatternMatcher[] = deniedCommands
      .filter((c) => c.includes('*'))
      .map((c) => ({
        test: (text: string) => wildcardMatch(c, text),
        source: c,
        type: 'wildcard' as const,
      }));

    // Wrap user-provided regex patterns with safe execution
    this.allowedPatterns = [
      ...allowedWildcards,
      ...allowedPatterns.map((p) => ({
        test: (text: string) => safeRegexTest(p, text),
        source: p,
        type: 'regex' as const,
      })),
    ];
    this.deniedPatterns = [
      ...deniedWildcards,
      ...deniedPatterns.map((p) => ({
        test: (text: string) => safeRegexTest(p, text),
        source: p,
        type: 'regex' as const,
      })),
    ];
  }

  /**
   * Normalize command for matching (trim, collapse whitespace)
   */
  private normalizeCommand(command: string): string {
    return command.trim().replace(/\s+/g, ' ');
  }

  /**
   * Check if a command matches an exact string
   */
  matchExact(command: string, exactList: string[]): CommandMatchResult {
    const normalized = this.normalizeCommand(command);

    for (const exact of exactList) {
      if (normalized === exact || normalized.startsWith(exact + ' ')) {
        return { matches: true, matchedPattern: exact, matchedBy: 'exact' };
      }
    }

    return { matches: false, matchedBy: 'none' };
  }

  /**
   * Check if a command matches any pattern matcher
   */
  matchPatterns(command: string, patterns: PatternMatcher[]): CommandMatchResult {
    const normalized = this.normalizeCommand(command);

    for (const pattern of patterns) {
      if (pattern.test(normalized)) {
        return { matches: true, matchedPattern: pattern.source, matchedBy: pattern.type === 'wildcard' ? 'wildcard' : 'regex' };
      }
    }

    return { matches: false, matchedBy: 'none' };
  }

  /**
   * Check if a command is allowed
   * Denied commands take precedence over allowed
   */
  isAllowed(command: string): CommandMatchResult {
    const normalized = this.normalizeCommand(command);

    // Check denied exact matches first
    const deniedExact = this.matchExact(normalized, this.deniedExact);
    if (deniedExact.matches) {
      return { matches: false, matchedPattern: deniedExact.matchedPattern, matchedBy: 'exact' };
    }

    // Check denied patterns
    const deniedPattern = this.matchPatterns(normalized, this.deniedPatterns);
    if (deniedPattern.matches) {
      return {
        matches: false,
        matchedPattern: deniedPattern.matchedPattern,
        matchedBy: deniedPattern.matchedBy,
      };
    }

    // Check allowed exact matches
    const allowedExact = this.matchExact(normalized, this.allowedExact);
    if (allowedExact.matches) {
      return allowedExact;
    }

    // Check allowed patterns
    const allowedPattern = this.matchPatterns(normalized, this.allowedPatterns);
    if (allowedPattern.matches) {
      return allowedPattern;
    }

    // Not in allowed list
    return { matches: false, matchedBy: 'none' };
  }

  /**
   * Check if a command is explicitly denied
   */
  isDenied(command: string): CommandMatchResult {
    const normalized = this.normalizeCommand(command);

    // Check denied exact matches
    const deniedExact = this.matchExact(normalized, this.deniedExact);
    if (deniedExact.matches) {
      return deniedExact;
    }

    // Check denied patterns
    const deniedPattern = this.matchPatterns(normalized, this.deniedPatterns);
    if (deniedPattern.matches) {
      return {
        matches: true,
        matchedPattern: deniedPattern.matchedPattern,
        matchedBy: deniedPattern.matchedBy,
      };
    }

    return { matches: false, matchedBy: 'none' };
  }

  /**
   * Extract the base command (first word) from a command string
   */
  static extractBaseCommand(command: string): string {
    const normalized = command.trim();
    const firstSpace = normalized.indexOf(' ');
    return firstSpace === -1 ? normalized : normalized.substring(0, firstSpace);
  }

  /**
   * Check if a command contains potentially dangerous patterns
   */
  static containsDangerousPatterns(command: string): {
    dangerous: boolean;
    patterns: string[];
  } {
    const dangerousPatterns = [
      { pattern: /rm\s+-rf\s+\//, description: 'rm -rf /' },
      { pattern: /sudo\b/, description: 'sudo' },
      { pattern: /\|\s*(bash|sh)\b/, description: 'pipe to shell' },
      { pattern: />\s*\/dev\/sd[a-z]/, description: 'write to block device' },
      { pattern: /:\(\)\s*{\s*:\|:&\s*};:/, description: 'fork bomb' },
      { pattern: /mkfs\b/, description: 'mkfs' },
      { pattern: /dd\s+if=\/dev\//, description: 'dd from device' },
      { pattern: /chmod\s+777\s+\//, description: 'chmod 777 /' },
      { pattern: /eval\s*\$/, description: 'eval variable' },
      { pattern: /`.*`/, description: 'command substitution' },
      { pattern: /\$\(.*\)/, description: 'command substitution' },
    ];

    const foundPatterns: string[] = [];

    for (const { pattern, description } of dangerousPatterns) {
      if (pattern.test(command)) {
        foundPatterns.push(description);
      }
    }

    return { dangerous: foundPatterns.length > 0, patterns: foundPatterns };
  }
}

/**
 * Create a CommandMatcher from command permissions
 */
export function createCommandMatcher(
  allowed: string[],
  denied: string[],
  patterns: { allow: string[]; deny: string[] },
): CommandMatcher {
  return new CommandMatcher(allowed, denied, patterns.allow, patterns.deny);
}
