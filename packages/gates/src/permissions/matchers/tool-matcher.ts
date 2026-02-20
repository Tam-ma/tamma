/**
 * Tool name matching for agent tools
 * @module @tamma/gates/permissions/matchers/tool-matcher
 */

export interface ToolMatchResult {
  matches: boolean;
  matchedIn: 'allowed' | 'denied' | 'requireApproval' | 'none';
}

/**
 * Matcher for tool names
 * Supports exact matching and wildcard patterns
 */
export class ToolMatcher {
  private readonly allowed: Set<string>;
  private readonly denied: Set<string>;
  private readonly requireApproval: Set<string>;
  private readonly allowedPatterns: RegExp[];
  private readonly deniedPatterns: RegExp[];

  constructor(
    allowed: string[] = [],
    denied: string[] = [],
    requireApproval: string[] = [],
  ) {
    // Separate exact matches from patterns
    this.allowed = new Set(allowed.filter((t) => !t.includes('*')));
    this.denied = new Set(denied.filter((t) => !t.includes('*')));
    this.requireApproval = new Set(requireApproval.filter((t) => !t.includes('*')));

    // Convert wildcards to regex
    this.allowedPatterns = allowed
      .filter((t) => t.includes('*'))
      .map((t) => this.wildcardToRegex(t));
    this.deniedPatterns = denied
      .filter((t) => t.includes('*'))
      .map((t) => this.wildcardToRegex(t));
  }

  /**
   * Convert a wildcard pattern to regex
   */
  private wildcardToRegex(pattern: string): RegExp {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = escaped.replace(/\\\*/g, '.*');
    return new RegExp(`^${regex}$`, 'i');
  }

  /**
   * Check if a tool name matches any pattern
   */
  private matchesPatterns(tool: string, patterns: RegExp[]): boolean {
    const normalized = tool.trim();
    return patterns.some((p) => p.test(normalized));
  }

  /**
   * Check if a tool is in the allowed list
   */
  isAllowed(tool: string): boolean {
    const normalized = tool.trim();
    return this.allowed.has(normalized) || this.matchesPatterns(normalized, this.allowedPatterns);
  }

  /**
   * Check if a tool is in the denied list
   */
  isDenied(tool: string): boolean {
    const normalized = tool.trim();
    return this.denied.has(normalized) || this.matchesPatterns(normalized, this.deniedPatterns);
  }

  /**
   * Check if a tool requires approval
   */
  requiresApproval(tool: string): boolean {
    const normalized = tool.trim();
    return this.requireApproval.has(normalized);
  }

  /**
   * Get the permission status for a tool
   * Priority: denied > requireApproval > allowed > not found
   */
  check(tool: string): ToolMatchResult {
    const normalized = tool.trim();

    // Check denied first (highest priority)
    if (this.isDenied(normalized)) {
      return { matches: true, matchedIn: 'denied' };
    }

    // Check require approval
    if (this.requiresApproval(normalized)) {
      return { matches: true, matchedIn: 'requireApproval' };
    }

    // Check allowed
    if (this.isAllowed(normalized)) {
      return { matches: true, matchedIn: 'allowed' };
    }

    // Not found in any list
    return { matches: false, matchedIn: 'none' };
  }

  /**
   * Get all tools in each category
   */
  getLists(): {
    allowed: string[];
    denied: string[];
    requireApproval: string[];
  } {
    return {
      allowed: [...this.allowed],
      denied: [...this.denied],
      requireApproval: [...this.requireApproval],
    };
  }
}

/**
 * Create a ToolMatcher from tool permissions
 */
export function createToolMatcher(
  allowed: string[],
  denied: string[],
  requireApproval: string[] = [],
): ToolMatcher {
  return new ToolMatcher(allowed, denied, requireApproval);
}

/**
 * Check if a tool name is valid (alphanumeric, underscores, hyphens)
 */
export function isValidToolName(tool: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(tool);
}

/**
 * Normalize a tool name to standard form (capitalize first letter)
 */
export function normalizeToolName(tool: string): string {
  const trimmed = tool.trim();
  if (trimmed.length === 0) return trimmed;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}
