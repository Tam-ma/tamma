/**
 * RAG Sources Module
 *
 * Exports all RAG source adapters for multi-source retrieval.
 */

// Base interface
export { BaseRAGSource } from './source-interface.js';

// Vector source
export {
  VectorSource,
  createVectorSource,
  type VectorSourceConfig,
} from './vector-source.js';

// Keyword source
export {
  KeywordSource,
  createKeywordSource,
  type KeywordDocument,
} from './keyword-source.js';

// Docs source
export {
  DocsSource,
  createDocsSource,
  type DocEntry,
} from './docs-source.js';

// GitHub sources
export {
  IssuesSource,
  PullRequestsSource,
  CommitsSource,
  createIssuesSource,
  createPullRequestsSource,
  createCommitsSource,
  type GitHubEntry,
  type GitHubContentType,
} from './github-source.js';
