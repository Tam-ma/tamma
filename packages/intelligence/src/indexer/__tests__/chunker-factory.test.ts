/**
 * Tests for Chunker Factory
 */

import { describe, it, expect } from 'vitest';
import {
  ChunkerFactory,
  chunkerFactory,
  DEFAULT_STRATEGIES,
} from '../chunking/chunker-factory.js';
import { TypeScriptChunker } from '../chunking/typescript-chunker.js';
import { GenericChunker } from '../chunking/generic-chunker.js';

describe('ChunkerFactory', () => {
  let factory: ChunkerFactory;

  beforeEach(() => {
    factory = new ChunkerFactory();
  });

  describe('getChunker', () => {
    it('should return TypeScriptChunker for TypeScript', () => {
      const chunker = factory.getChunker('typescript');
      expect(chunker).toBeInstanceOf(TypeScriptChunker);
    });

    it('should return TypeScriptChunker for JavaScript', () => {
      const chunker = factory.getChunker('javascript');
      expect(chunker).toBeInstanceOf(TypeScriptChunker);
    });

    it('should return GenericChunker for Python', () => {
      const chunker = factory.getChunker('python');
      expect(chunker).toBeInstanceOf(GenericChunker);
    });

    it('should return GenericChunker for Go', () => {
      const chunker = factory.getChunker('go');
      expect(chunker).toBeInstanceOf(GenericChunker);
    });

    it('should return GenericChunker for Rust', () => {
      const chunker = factory.getChunker('rust');
      expect(chunker).toBeInstanceOf(GenericChunker);
    });

    it('should return GenericChunker for Java', () => {
      const chunker = factory.getChunker('java');
      expect(chunker).toBeInstanceOf(GenericChunker);
    });

    it('should return GenericChunker for unknown languages', () => {
      const chunker = factory.getChunker('unknown');
      expect(chunker).toBeInstanceOf(GenericChunker);
    });
  });

  describe('getDefaultStrategy', () => {
    it('should return strategy for TypeScript', () => {
      const strategy = factory.getDefaultStrategy('typescript');

      expect(strategy.language).toBe('typescript');
      expect(strategy.parser).toBe('typescript');
      expect(strategy.maxChunkTokens).toBe(512);
    });

    it('should return strategy for JavaScript', () => {
      const strategy = factory.getDefaultStrategy('javascript');

      expect(strategy.language).toBe('javascript');
      expect(strategy.parser).toBe('typescript');
    });

    it('should return strategy for Python', () => {
      const strategy = factory.getDefaultStrategy('python');

      expect(strategy.language).toBe('python');
      expect(strategy.parser).toBe('generic');
    });

    it('should return strategy for unknown languages', () => {
      const strategy = factory.getDefaultStrategy('unknown');

      expect(strategy.language).toBe('unknown');
      expect(strategy.parser).toBe('generic');
    });
  });

  describe('createStrategy', () => {
    it('should create strategy with defaults', () => {
      const strategy = factory.createStrategy('typescript');

      expect(strategy.language).toBe('typescript');
      expect(strategy.maxChunkTokens).toBe(512);
    });

    it('should create strategy with overrides', () => {
      const strategy = factory.createStrategy('typescript', {
        maxChunkTokens: 256,
        overlapTokens: 100,
      });

      expect(strategy.language).toBe('typescript');
      expect(strategy.maxChunkTokens).toBe(256);
      expect(strategy.overlapTokens).toBe(100);
    });

    it('should preserve language even with override attempt', () => {
      const strategy = factory.createStrategy('typescript', {
        language: 'python' as any,
      });

      expect(strategy.language).toBe('typescript');
    });
  });

  describe('getSupportedLanguages', () => {
    it('should return all supported languages', () => {
      const languages = factory.getSupportedLanguages();

      expect(languages).toContain('typescript');
      expect(languages).toContain('javascript');
      expect(languages).toContain('python');
      expect(languages).toContain('go');
      expect(languages).toContain('rust');
      expect(languages).toContain('java');
      expect(languages).toContain('unknown');
    });
  });

  describe('hasAstChunking', () => {
    it('should return true for TypeScript', () => {
      expect(factory.hasAstChunking('typescript')).toBe(true);
    });

    it('should return true for JavaScript', () => {
      expect(factory.hasAstChunking('javascript')).toBe(true);
    });

    it('should return false for Python', () => {
      expect(factory.hasAstChunking('python')).toBe(false);
    });

    it('should return false for Go', () => {
      expect(factory.hasAstChunking('go')).toBe(false);
    });

    it('should return false for unknown', () => {
      expect(factory.hasAstChunking('unknown')).toBe(false);
    });
  });
});

describe('chunkerFactory singleton', () => {
  it('should be a ChunkerFactory instance', () => {
    expect(chunkerFactory).toBeInstanceOf(ChunkerFactory);
  });

  it('should work same as new instance', () => {
    const languages = chunkerFactory.getSupportedLanguages();
    expect(languages.length).toBeGreaterThan(0);
  });
});

describe('DEFAULT_STRATEGIES', () => {
  it('should have strategy for TypeScript', () => {
    expect(DEFAULT_STRATEGIES.typescript).toBeDefined();
    expect(DEFAULT_STRATEGIES.typescript.language).toBe('typescript');
  });

  it('should have strategy for JavaScript', () => {
    expect(DEFAULT_STRATEGIES.javascript).toBeDefined();
    expect(DEFAULT_STRATEGIES.javascript.language).toBe('javascript');
  });

  it('should have strategy for Python', () => {
    expect(DEFAULT_STRATEGIES.python).toBeDefined();
    expect(DEFAULT_STRATEGIES.python.language).toBe('python');
  });

  it('should have strategy for Go', () => {
    expect(DEFAULT_STRATEGIES.go).toBeDefined();
    expect(DEFAULT_STRATEGIES.go.language).toBe('go');
  });

  it('should have strategy for Rust', () => {
    expect(DEFAULT_STRATEGIES.rust).toBeDefined();
    expect(DEFAULT_STRATEGIES.rust.language).toBe('rust');
  });

  it('should have strategy for Java', () => {
    expect(DEFAULT_STRATEGIES.java).toBeDefined();
    expect(DEFAULT_STRATEGIES.java.language).toBe('java');
  });

  it('should have strategy for unknown', () => {
    expect(DEFAULT_STRATEGIES.unknown).toBeDefined();
    expect(DEFAULT_STRATEGIES.unknown.language).toBe('unknown');
  });

  it('should have consistent default values', () => {
    for (const [, strategy] of Object.entries(DEFAULT_STRATEGIES)) {
      expect(strategy.maxChunkTokens).toBe(512);
      expect(strategy.overlapTokens).toBe(50);
    }
  });
});
