/**
 * Relevance Ranker
 *
 * Combines match scores from multiple matchers and ranks entries by relevance.
 */

import type { KnowledgeEntry, KnowledgeQuery, KnowledgePriority } from '@tamma/shared';
import type { IRelevanceRanker, MatchResult, RankedEntry } from '../types.js';

/**
 * Options for relevance ranking
 */
export interface RelevanceRankerOptions {
  /** Weight for keyword match scores */
  keywordWeight: number;
  /** Weight for pattern match scores */
  patternWeight: number;
  /** Weight for semantic match scores */
  semanticWeight: number;
  /** Priority boost multipliers */
  priorityBoosts: Record<KnowledgePriority, number>;
  /** Recency decay factor (0 = no decay, 1 = heavy decay) */
  recencyDecay: number;
  /** Application success boost (helpfulness ratio) */
  helpfulnessBoost: number;
}

/**
 * Default ranker options
 */
const DEFAULT_OPTIONS: RelevanceRankerOptions = {
  keywordWeight: 0.3,
  patternWeight: 0.4,
  semanticWeight: 0.3,
  priorityBoosts: {
    low: 0.8,
    medium: 1.0,
    high: 1.2,
    critical: 1.5,
  },
  recencyDecay: 0.1,
  helpfulnessBoost: 0.2,
};

/**
 * Default priority order for comparison
 */
const PRIORITY_ORDER: Record<KnowledgePriority, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * Relevance ranker implementation
 */
export class RelevanceRanker implements IRelevanceRanker {
  private options: RelevanceRankerOptions;

  constructor(options?: Partial<RelevanceRankerOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async rank(
    entries: KnowledgeEntry[],
    query: KnowledgeQuery,
    matches: Map<string, MatchResult>
  ): Promise<RankedEntry[]> {
    const rankedEntries: RankedEntry[] = [];

    for (const entry of entries) {
      const matchResult = matches.get(entry.id);
      if (!matchResult) {
        continue;
      }

      // Calculate base score from match
      let score = this.calculateBaseScore(matchResult);

      // Apply priority boost
      score *= this.options.priorityBoosts[entry.priority];

      // Apply recency boost (more recent entries score higher)
      score *= this.calculateRecencyBoost(entry);

      // Apply helpfulness boost
      score *= this.calculateHelpfulnessBoost(entry);

      // Apply scope relevance
      score *= this.calculateScopeRelevance(entry, query);

      // Apply agent type relevance
      score *= this.calculateAgentTypeRelevance(entry, query);

      rankedEntries.push({
        entry,
        score,
        matchResult,
      });
    }

    // Sort by score (descending), then by priority, then by recency
    rankedEntries.sort((a, b) => {
      // Primary: score
      if (Math.abs(a.score - b.score) > 0.01) {
        return b.score - a.score;
      }

      // Secondary: priority
      const priorityDiff =
        PRIORITY_ORDER[b.entry.priority] - PRIORITY_ORDER[a.entry.priority];
      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      // Tertiary: recency
      return b.entry.updatedAt.getTime() - a.entry.updatedAt.getTime();
    });

    return rankedEntries;
  }

  /**
   * Calculate base score from match result
   */
  private calculateBaseScore(matchResult: MatchResult): number {
    const { matchType, score } = matchResult;

    let weight: number;
    switch (matchType) {
      case 'keyword':
        weight = this.options.keywordWeight;
        break;
      case 'pattern':
        weight = this.options.patternWeight;
        break;
      case 'semantic':
        weight = this.options.semanticWeight;
        break;
      case 'combined':
        // Combined matches use average weight
        weight =
          (this.options.keywordWeight +
            this.options.patternWeight +
            this.options.semanticWeight) /
          3;
        break;
      default:
        weight = 1;
    }

    return score * weight;
  }

  /**
   * Calculate recency boost based on last update
   */
  private calculateRecencyBoost(entry: KnowledgeEntry): number {
    if (this.options.recencyDecay === 0) {
      return 1;
    }

    const now = Date.now();
    const updateAge = now - entry.updatedAt.getTime();
    const daysSinceUpdate = updateAge / (1000 * 60 * 60 * 24);

    // Decay formula: 1 / (1 + decay * days)
    // Results in boost from 1 (recent) down to lower values (older)
    return 1 / (1 + this.options.recencyDecay * daysSinceUpdate / 30);
  }

  /**
   * Calculate helpfulness boost based on application statistics
   */
  private calculateHelpfulnessBoost(entry: KnowledgeEntry): number {
    if (entry.timesApplied === 0) {
      return 1; // No data, neutral
    }

    const helpfulnessRatio = entry.timesHelpful / entry.timesApplied;
    // Scale from 0.8 (never helpful) to 1.2 (always helpful)
    return 0.8 + helpfulnessRatio * this.options.helpfulnessBoost * 2;
  }

  /**
   * Calculate scope relevance
   */
  private calculateScopeRelevance(
    entry: KnowledgeEntry,
    query: KnowledgeQuery
  ): number {
    switch (entry.scope) {
      case 'project':
        // Project-specific entries get boost when matching project
        return entry.projectId === query.projectId ? 1.3 : 0.5;
      case 'agent_type':
        // Agent-type entries get boost when matching agent type
        if (entry.agentTypes?.includes(query.agentType)) {
          return 1.2;
        }
        return entry.agentTypes?.length ? 0.7 : 1;
      case 'global':
        // Global entries are always relevant but don't get special boost
        return 1;
      default:
        return 1;
    }
  }

  /**
   * Calculate agent type relevance
   */
  private calculateAgentTypeRelevance(
    entry: KnowledgeEntry,
    query: KnowledgeQuery
  ): number {
    // If entry doesn't specify agent types, it applies to all
    if (!entry.agentTypes || entry.agentTypes.length === 0) {
      return 1;
    }

    // Check if query agent type is in the list
    return entry.agentTypes.includes(query.agentType) ? 1 : 0.6;
  }
}

/**
 * Combine multiple match results into a single result
 */
export function combineMatchResults(results: MatchResult[]): MatchResult | null {
  const validResults = results.filter((r) => r !== null);
  if (validResults.length === 0) {
    return null;
  }

  // Calculate combined score (weighted average based on match type weights)
  const weights: Record<string, number> = {
    keyword: 0.3,
    pattern: 0.4,
    semantic: 0.3,
  };

  let totalScore = 0;
  let totalWeight = 0;
  const reasons: string[] = [];

  for (const result of validResults) {
    const weight = weights[result.matchType] ?? 0.33;
    totalScore += result.score * weight;
    totalWeight += weight;
    reasons.push(result.reason);
  }

  const combinedScore = totalWeight > 0 ? totalScore / totalWeight : 0;

  return {
    matched: true,
    score: combinedScore,
    reason: reasons.join('; '),
    matchType: 'combined',
  };
}
