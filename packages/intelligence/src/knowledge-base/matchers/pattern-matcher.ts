/**
 * Pattern Matcher
 *
 * Matches knowledge entries based on regex patterns against file paths and content.
 */

import type { KnowledgeEntry } from '@tamma/shared';
import type { IKnowledgeMatcher, MatchContext, MatchResult } from '../types.js';

/**
 * Options for pattern matching
 */
export interface PatternMatcherOptions {
  /** Whether to match against task description */
  matchDescription: boolean;
  /** Whether to match against plan approach */
  matchApproach: boolean;
  /** Whether to match against file paths */
  matchFilePaths: boolean;
  /** Case-insensitive pattern matching */
  caseInsensitive: boolean;
}

/**
 * Default pattern matcher options
 */
const DEFAULT_OPTIONS: PatternMatcherOptions = {
  matchDescription: true,
  matchApproach: true,
  matchFilePaths: true,
  caseInsensitive: true,
};

/**
 * Pattern match result details
 */
interface PatternMatchDetails {
  /** The pattern that matched */
  pattern: string;
  /** What it matched against */
  matchedIn: 'description' | 'approach' | 'filePath';
  /** The matched text */
  matchedText: string;
}

/**
 * Safely compile regex with error handling
 */
function safeRegex(pattern: string, flags?: string): RegExp | null {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

/**
 * Pattern-based knowledge matcher
 */
export class PatternMatcher implements IKnowledgeMatcher {
  private options: PatternMatcherOptions;

  constructor(options?: Partial<PatternMatcherOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async match(
    entry: KnowledgeEntry,
    context: MatchContext
  ): Promise<MatchResult | null> {
    // Skip if no patterns defined
    if (!entry.patterns || entry.patterns.length === 0) {
      return null;
    }

    const matchDetails: PatternMatchDetails[] = [];
    const flags = this.options.caseInsensitive ? 'i' : '';

    for (const pattern of entry.patterns) {
      const regex = safeRegex(pattern, flags);
      if (!regex) {
        // Skip invalid patterns
        continue;
      }

      // Match against task description
      if (this.options.matchDescription && context.taskDescription) {
        const match = regex.exec(context.taskDescription);
        if (match) {
          matchDetails.push({
            pattern,
            matchedIn: 'description',
            matchedText: match[0],
          });
          continue; // Move to next pattern
        }
      }

      // Match against plan approach
      if (this.options.matchApproach && context.planApproach) {
        const match = regex.exec(context.planApproach);
        if (match) {
          matchDetails.push({
            pattern,
            matchedIn: 'approach',
            matchedText: match[0],
          });
          continue;
        }
      }

      // Match against file paths
      if (this.options.matchFilePaths && context.filePaths) {
        for (const filePath of context.filePaths) {
          const match = regex.exec(filePath);
          if (match) {
            matchDetails.push({
              pattern,
              matchedIn: 'filePath',
              matchedText: filePath,
            });
            break; // Don't match same pattern multiple times
          }
        }
      }
    }

    if (matchDetails.length === 0) {
      return null;
    }

    // Calculate score based on match coverage
    const patternCoverage = matchDetails.length / entry.patterns.length;

    // File path matches are weighted higher for prohibitions
    const filePathMatches = matchDetails.filter(
      (m) => m.matchedIn === 'filePath'
    ).length;
    const filePathBonus = entry.type === 'prohibition' ? filePathMatches * 0.2 : 0;

    const score = Math.min(1, patternCoverage * 0.8 + filePathBonus);

    // Build detailed reason
    const reasons: string[] = [];

    const filePathReasons = matchDetails
      .filter((m) => m.matchedIn === 'filePath')
      .map((m) => `"${m.matchedText}"`)
      .slice(0, 3);
    if (filePathReasons.length > 0) {
      reasons.push(`File path match: ${filePathReasons.join(', ')}`);
    }

    const descriptionMatch = matchDetails.find((m) => m.matchedIn === 'description');
    if (descriptionMatch) {
      reasons.push(`Description matches pattern: ${descriptionMatch.pattern}`);
    }

    const approachMatch = matchDetails.find((m) => m.matchedIn === 'approach');
    if (approachMatch) {
      reasons.push(`Approach matches pattern: ${approachMatch.pattern}`);
    }

    return {
      matched: true,
      score,
      reason: reasons.join('; '),
      matchType: 'pattern',
    };
  }
}
