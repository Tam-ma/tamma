/**
 * Chunker Factory
 *
 * Factory for creating language-specific code chunkers.
 */

import type { ICodeChunker, SupportedLanguage, ChunkingStrategy } from '../types.js';
import { TypeScriptChunker } from './typescript-chunker.js';
import { GenericChunker } from './generic-chunker.js';

/**
 * Default chunking strategies by language
 */
export const DEFAULT_STRATEGIES: Record<SupportedLanguage, ChunkingStrategy> = {
  typescript: {
    language: 'typescript',
    parser: 'typescript',
    maxChunkTokens: 512,
    overlapTokens: 50,
    preserveImports: true,
    groupRelatedCode: true,
  },
  javascript: {
    language: 'javascript',
    parser: 'typescript', // TypeScript parser handles JS too
    maxChunkTokens: 512,
    overlapTokens: 50,
    preserveImports: true,
    groupRelatedCode: true,
  },
  python: {
    language: 'python',
    parser: 'generic', // Could use tree-sitter in the future
    maxChunkTokens: 512,
    overlapTokens: 50,
    preserveImports: true,
    groupRelatedCode: true,
  },
  go: {
    language: 'go',
    parser: 'generic',
    maxChunkTokens: 512,
    overlapTokens: 50,
    preserveImports: true,
    groupRelatedCode: true,
  },
  rust: {
    language: 'rust',
    parser: 'generic',
    maxChunkTokens: 512,
    overlapTokens: 50,
    preserveImports: true,
    groupRelatedCode: true,
  },
  java: {
    language: 'java',
    parser: 'generic',
    maxChunkTokens: 512,
    overlapTokens: 50,
    preserveImports: true,
    groupRelatedCode: true,
  },
  unknown: {
    language: 'unknown',
    parser: 'generic',
    maxChunkTokens: 512,
    overlapTokens: 50,
    preserveImports: false,
    groupRelatedCode: false,
  },
};

/**
 * Factory for creating code chunkers
 */
export class ChunkerFactory {
  private typescriptChunker: TypeScriptChunker;
  private genericChunker: GenericChunker;

  constructor() {
    this.typescriptChunker = new TypeScriptChunker();
    this.genericChunker = new GenericChunker();
  }

  /**
   * Get the appropriate chunker for a language
   * @param language - Programming language
   * @returns Code chunker instance
   */
  getChunker(language: SupportedLanguage): ICodeChunker {
    switch (language) {
      case 'typescript':
      case 'javascript':
        return this.typescriptChunker;
      case 'python':
      case 'go':
      case 'rust':
      case 'java':
      case 'unknown':
      default:
        return this.genericChunker;
    }
  }

  /**
   * Get the default strategy for a language
   * @param language - Programming language
   * @returns Default chunking strategy
   */
  getDefaultStrategy(language: SupportedLanguage): ChunkingStrategy {
    return DEFAULT_STRATEGIES[language] ?? DEFAULT_STRATEGIES.unknown;
  }

  /**
   * Create a custom strategy with overrides
   * @param language - Programming language
   * @param overrides - Strategy overrides
   * @returns Custom chunking strategy
   */
  createStrategy(
    language: SupportedLanguage,
    overrides?: Partial<ChunkingStrategy>,
  ): ChunkingStrategy {
    const defaultStrategy = this.getDefaultStrategy(language);
    return {
      ...defaultStrategy,
      ...overrides,
      language, // Ensure language is always correct
    };
  }

  /**
   * Get all supported languages
   * @returns Array of supported languages
   */
  getSupportedLanguages(): SupportedLanguage[] {
    return ['typescript', 'javascript', 'python', 'go', 'rust', 'java', 'unknown'];
  }

  /**
   * Check if a language has AST-based chunking
   * @param language - Programming language
   * @returns True if AST-based chunking is available
   */
  hasAstChunking(language: SupportedLanguage): boolean {
    return language === 'typescript' || language === 'javascript';
  }
}

/**
 * Singleton chunker factory instance
 */
export const chunkerFactory = new ChunkerFactory();
