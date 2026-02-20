/**
 * Knowledge Matchers
 *
 * Matching algorithms for finding relevant knowledge entries.
 */

export { KeywordMatcher, type KeywordMatcherOptions } from './keyword-matcher.js';
export { PatternMatcher, type PatternMatcherOptions } from './pattern-matcher.js';
export { SemanticMatcher, type SemanticMatcherOptions } from './semantic-matcher.js';
export {
  RelevanceRanker,
  combineMatchResults,
  type RelevanceRankerOptions,
} from './relevance-ranker.js';
