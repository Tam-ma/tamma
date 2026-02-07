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
 * Check if a regex pattern is safe from ReDoS attacks.
 * Rejects patterns with nested quantifiers like (a+)+, (a*)*,  (a?)*.
 * Uses string scanning instead of regex to avoid being vulnerable itself.
 */
function isSafeRegex(pattern: string): boolean {
  // Reject excessively long patterns
  if (pattern.length > 200) return false;

  // Scan for nested quantifiers: a group ending with a quantifier,
  // where the group itself is followed by a quantifier.
  // Walk characters, track paren depth, detect quantifiers.
  let depth = 0;
  const quantifiers = new Set(['+', '*', '?']);

  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    // Skip escaped characters
    if (ch === '\\') { i++; continue; }
    if (ch === '(') { depth++; continue; }
    if (ch === ')') {
      depth--;
      // Check if the next char after ')' is a quantifier
      const next = pattern[i + 1];
      if (next && (quantifiers.has(next) || next === '{')) {
        // Walk backwards inside the group to see if there's a quantifier before ')'
        for (let j = i - 1; j >= 0; j--) {
          const inner = pattern[j];
          if (inner === '(') break; // reached group start
          if (inner === '\\') continue; // skip escaped
          if (quantifiers.has(inner) || inner === '}') {
            return false; // nested quantifier detected
          }
          // Only look at the last meaningful char before ')'
          break;
        }
      }
      continue;
    }
  }

  return true;
}

/**
 * Safely compile a regex pattern. Returns a RegExp if the pattern is valid and safe,
 * or falls back to a literal string match RegExp if the pattern is unsafe or invalid.
 */
function safeCompileRegex(pattern: string, flags: string): RegExp {
  if (!isSafeRegex(pattern)) {
    // Treat as literal string match by escaping special regex characters
    const escaped = pattern.replace(/[.*+?^${}()|\\\[\]]/g, '\\$&');
    return new RegExp(escaped, flags);
  }
  try {
    return new RegExp(pattern, flags);
  } catch {
    // Invalid regex - treat as literal string match
    const escaped = pattern.replace(/[.*+?^${}()|\\\[\]]/g, '\\$&');
    return new RegExp(escaped, flags);
  }
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
  private readonly allowedPatterns: RegExp[];
  private readonly deniedPatterns: RegExp[];

  constructor(
    allowedCommands: string[] = [],
    deniedCommands: string[] = [],
    allowedPatterns: string[] = [],
    deniedPatterns: string[] = [],
  ) {
    this.allowedExact = allowedCommands.filter((c) => !c.includes('*'));
    this.deniedExact = deniedCommands.filter((c) => !c.includes('*'));

    // Convert wildcard commands to patterns
    const allowedWildcards = allowedCommands
      .filter((c) => c.includes('*'))
      .map((c) => this.wildcardToRegex(c));
    const deniedWildcards = deniedCommands
      .filter((c) => c.includes('*'))
      .map((c) => this.wildcardToRegex(c));

    // Compile regex patterns with safety checks
    this.allowedPatterns = [
      ...allowedWildcards,
      ...allowedPatterns.map((p) => safeCompileRegex(p, 'i')),
    ];
    this.deniedPatterns = [
      ...deniedWildcards,
      ...deniedPatterns.map((p) => safeCompileRegex(p, 'i')),
    ];
  }

  /**
   * Convert a wildcard pattern to a regex
   * 'npm run *' -> /^npm run .+$/i
   */
  private wildcardToRegex(pattern: string): RegExp {
    // Escape special regex characters except *
    // Note: [ and ] must be escaped with backslash inside the character class
    const escaped = pattern.replace(/[.+?^${}()|\\\[\]]/g, '\\$&');
    // Replace consecutive * sequences with a single .* to avoid
    // polynomial backtracking (e.g., ^.*.*.*$ is catastrophic)
    const regex = escaped.replace(/\*+/g, '.*');
    return new RegExp(`^${regex}$`, 'i');
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
   * Check if a command matches any regex pattern
   */
  matchPatterns(command: string, patterns: RegExp[]): CommandMatchResult {
    const normalized = this.normalizeCommand(command);

    for (const pattern of patterns) {
      if (pattern.test(normalized)) {
        return { matches: true, matchedPattern: pattern.source, matchedBy: 'regex' };
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
