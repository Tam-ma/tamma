/**
 * Keyword Matcher
 *
 * Matches knowledge entries based on keyword overlap with fuzzy matching support.
 */

import type { KnowledgeEntry } from '@tamma/shared';
import type { IKnowledgeMatcher, MatchContext, MatchResult } from '../types.js';

/**
 * Options for keyword matching
 */
export interface KeywordMatcherOptions {
  /** Maximum Levenshtein distance for fuzzy matching */
  maxDistance: number;
  /** Case-insensitive matching */
  caseInsensitive: boolean;
  /** Minimum number of keywords that must match */
  minMatches: number;
  /** Score boost multiplier */
  scoreBoost: number;
}

/**
 * Default keyword matcher options
 */
const DEFAULT_OPTIONS: KeywordMatcherOptions = {
  maxDistance: 2,
  caseInsensitive: true,
  minMatches: 1,
  scoreBoost: 1.5,
};

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  // Initialize matrix
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0]![j] = j;
  }

  // Fill matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,      // Deletion
        matrix[i]![j - 1]! + 1,      // Insertion
        matrix[i - 1]![j - 1]! + cost // Substitution
      );
    }
  }

  return matrix[b.length]![a.length]!;
}

/**
 * Extract keywords from text
 */
function extractKeywords(text: string): string[] {
  // Split on whitespace and common separators
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);

  // Remove common stop words
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these',
    'those', 'it', 'its', 'not', 'no', 'yes', 'all', 'any', 'some',
  ]);

  return words.filter((w) => !stopWords.has(w));
}

/**
 * Keyword-based knowledge matcher
 */
export class KeywordMatcher implements IKnowledgeMatcher {
  private options: KeywordMatcherOptions;

  constructor(options?: Partial<KeywordMatcherOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async match(
    entry: KnowledgeEntry,
    context: MatchContext
  ): Promise<MatchResult | null> {
    // Build context keywords
    const contextKeywords = new Set<string>();

    // Add keywords from task description
    for (const keyword of extractKeywords(context.taskDescription)) {
      contextKeywords.add(
        this.options.caseInsensitive ? keyword.toLowerCase() : keyword
      );
    }

    // Add keywords from plan approach
    if (context.planApproach) {
      for (const keyword of extractKeywords(context.planApproach)) {
        contextKeywords.add(
          this.options.caseInsensitive ? keyword.toLowerCase() : keyword
        );
      }
    }

    // Add technologies
    if (context.technologies) {
      for (const tech of context.technologies) {
        contextKeywords.add(
          this.options.caseInsensitive ? tech.toLowerCase() : tech
        );
      }
    }

    // Add file path keywords
    if (context.filePaths) {
      for (const filePath of context.filePaths) {
        // Extract meaningful parts from file paths
        const parts = filePath
          .split(/[/\\]/)
          .filter((p) => p.length > 0 && !p.startsWith('.'));
        for (const part of parts) {
          const keywords = extractKeywords(part);
          for (const keyword of keywords) {
            contextKeywords.add(
              this.options.caseInsensitive ? keyword.toLowerCase() : keyword
            );
          }
        }
      }
    }

    // Get entry keywords
    const entryKeywords = entry.keywords.map((k) =>
      this.options.caseInsensitive ? k.toLowerCase() : k
    );

    // Find matching keywords
    const matches: Array<{ entryKeyword: string; contextKeyword: string; exact: boolean }> = [];

    for (const entryKeyword of entryKeywords) {
      for (const contextKeyword of contextKeywords) {
        // Check exact match
        if (entryKeyword === contextKeyword) {
          matches.push({ entryKeyword, contextKeyword, exact: true });
          break;
        }

        // Check fuzzy match
        if (this.options.maxDistance > 0) {
          const distance = levenshteinDistance(entryKeyword, contextKeyword);
          if (distance <= this.options.maxDistance) {
            matches.push({ entryKeyword, contextKeyword, exact: false });
            break;
          }
        }

        // Check substring match
        if (
          contextKeyword.length > 3 &&
          (entryKeyword.includes(contextKeyword) ||
            contextKeyword.includes(entryKeyword))
        ) {
          matches.push({ entryKeyword, contextKeyword, exact: false });
          break;
        }
      }
    }

    // Check minimum matches
    if (matches.length < this.options.minMatches) {
      return null;
    }

    // Calculate score
    const exactMatches = matches.filter((m) => m.exact).length;
    const baseRatio = matches.length / entryKeywords.length;
    const exactFactor = matches.length > 0 ? exactMatches / matches.length : 0;
    const normBoost = this.options.scoreBoost / 1.5;
    let score = baseRatio * 0.5 + exactFactor * 0.25 + baseRatio * 0.25 * normBoost;
    score = Math.min(1, Math.max(0, score));

    // Build match reason
    const matchedKeywords = matches.map((m) => m.entryKeyword).slice(0, 5);
    const reason = `Matched keywords: ${matchedKeywords.join(', ')}${
      matches.length > 5 ? ` (+${matches.length - 5} more)` : ''
    }`;

    return {
      matched: true,
      score,
      reason,
      matchType: 'keyword',
    };
  }
}
