/**
 * Tests for TypeScript Chunker
 */

import { describe, it, expect } from 'vitest';
import { TypeScriptChunker } from '../chunking/typescript-chunker.js';
import type { ChunkingStrategy } from '../types.js';

describe('TypeScriptChunker', () => {
  let chunker: TypeScriptChunker;

  const defaultStrategy: ChunkingStrategy = {
    language: 'typescript',
    parser: 'typescript',
    maxChunkTokens: 512,
    overlapTokens: 50,
    preserveImports: true,
    groupRelatedCode: true,
  };

  beforeEach(() => {
    chunker = new TypeScriptChunker();
  });

  describe('supportedLanguages', () => {
    it('should support TypeScript and JavaScript', () => {
      expect(chunker.supportedLanguages).toContain('typescript');
      expect(chunker.supportedLanguages).toContain('javascript');
    });
  });

  describe('chunk', () => {
    describe('function extraction', () => {
      it('should extract function declarations', async () => {
        const code = `
function hello() {
  return 'world';
}

function goodbye() {
  return 'farewell';
}
`;
        const chunks = await chunker.chunk(code, 'test.ts', 'file-123', defaultStrategy);

        // Should have chunks for the functions
        const functionChunks = chunks.filter((c) => c.chunkType === 'function');
        expect(functionChunks.length).toBeGreaterThanOrEqual(1);

        // Check that function names are captured
        const names = functionChunks.map((c) => c.name);
        expect(names).toContain('hello');
      });

      it('should extract arrow functions assigned to const', async () => {
        const code = `
const fetchData = async () => {
  const response = await fetch('/api/data');
  return response.json();
};
`;
        const chunks = await chunker.chunk(code, 'test.ts', 'file-123', defaultStrategy);

        const functionChunks = chunks.filter((c) => c.chunkType === 'function');
        expect(functionChunks.length).toBeGreaterThanOrEqual(1);
      });

      it('should extract exported functions', async () => {
        const code = `
export function publicFunction() {
  return 'public';
}

function privateFunction() {
  return 'private';
}
`;
        const chunks = await chunker.chunk(code, 'test.ts', 'file-123', defaultStrategy);

        const publicChunk = chunks.find((c) => c.name === 'publicFunction');
        expect(publicChunk).toBeDefined();
        expect(publicChunk?.exports).toContain('publicFunction');
      });
    });

    describe('class extraction', () => {
      it('should extract class declarations', async () => {
        const code = `
class UserService {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async getUser(id: string): Promise<User> {
    return this.db.findUser(id);
  }
}
`;
        const chunks = await chunker.chunk(code, 'test.ts', 'file-123', defaultStrategy);

        const classChunks = chunks.filter((c) => c.chunkType === 'class');
        expect(classChunks.length).toBeGreaterThanOrEqual(1);
        expect(classChunks[0].name).toBe('UserService');
      });

      it('should extract exported classes', async () => {
        const code = `
export class ApiClient {
  async fetch(url: string) {
    return fetch(url);
  }
}
`;
        const chunks = await chunker.chunk(code, 'test.ts', 'file-123', defaultStrategy);

        const classChunk = chunks.find((c) => c.name === 'ApiClient');
        expect(classChunk).toBeDefined();
        expect(classChunk?.exports).toContain('ApiClient');
      });
    });

    describe('interface extraction', () => {
      it('should extract interface declarations', async () => {
        const code = `
interface User {
  id: string;
  name: string;
  email: string;
}

interface UserCreateInput {
  name: string;
  email: string;
}
`;
        const chunks = await chunker.chunk(code, 'test.ts', 'file-123', defaultStrategy);

        const interfaceChunks = chunks.filter((c) => c.chunkType === 'interface');
        expect(interfaceChunks.length).toBeGreaterThanOrEqual(1);
      });
    });

    describe('type alias extraction', () => {
      it('should extract type aliases', async () => {
        const code = `
type UserId = string;

type UserRole = 'admin' | 'user' | 'guest';

type UserWithRole = User & { role: UserRole };
`;
        const chunks = await chunker.chunk(code, 'test.ts', 'file-123', defaultStrategy);

        const typeChunks = chunks.filter((c) => c.chunkType === 'type');
        expect(typeChunks.length).toBeGreaterThanOrEqual(1);
      });
    });

    describe('enum extraction', () => {
      it('should extract enum declarations', async () => {
        const code = `
enum Status {
  Pending = 'pending',
  Active = 'active',
  Completed = 'completed',
}
`;
        const chunks = await chunker.chunk(code, 'test.ts', 'file-123', defaultStrategy);

        const enumChunks = chunks.filter((c) => c.chunkType === 'enum');
        expect(enumChunks.length).toBe(1);
        expect(enumChunks[0].name).toBe('Status');
      });
    });

    describe('import handling', () => {
      it('should extract imports as a separate chunk when preserveImports is true', async () => {
        const code = `
import { useState, useEffect } from 'react';
import type { User } from './types';
import axios from 'axios';

function Component() {
  const [data, setData] = useState(null);
  return null;
}
`;
        const chunks = await chunker.chunk(code, 'test.tsx', 'file-123', {
          ...defaultStrategy,
          preserveImports: true,
        });

        const importChunk = chunks.find((c) => c.chunkType === 'imports');
        expect(importChunk).toBeDefined();
        expect(importChunk?.imports).toContain('react');
        expect(importChunk?.imports).toContain('./types');
        expect(importChunk?.imports).toContain('axios');
      });

      it('should not create import chunk when preserveImports is false', async () => {
        const code = `
import { useState } from 'react';

function Component() {
  return null;
}
`;
        const chunks = await chunker.chunk(code, 'test.tsx', 'file-123', {
          ...defaultStrategy,
          preserveImports: false,
        });

        const importChunk = chunks.find((c) => c.chunkType === 'imports');
        expect(importChunk).toBeUndefined();
      });
    });

    describe('JSDoc extraction', () => {
      it('should extract JSDoc comments', async () => {
        const code = `
/**
 * Fetches user data from the API.
 * @param userId - The user's unique identifier
 * @returns The user object
 */
async function fetchUser(userId: string): Promise<User> {
  return api.get(\`/users/\${userId}\`);
}
`;
        const chunks = await chunker.chunk(code, 'test.ts', 'file-123', defaultStrategy);

        const functionChunk = chunks.find((c) => c.name === 'fetchUser');
        expect(functionChunk?.docstring).toBeDefined();
        expect(functionChunk?.docstring).toContain('Fetches user data');
        expect(functionChunk?.docstring).toContain('@param userId');
      });
    });

    describe('chunk metadata', () => {
      it('should include line numbers', async () => {
        const code = `function test() {
  return 42;
}`;
        const chunks = await chunker.chunk(code, 'test.ts', 'file-123', defaultStrategy);

        expect(chunks[0].startLine).toBeDefined();
        expect(chunks[0].endLine).toBeDefined();
        expect(chunks[0].startLine).toBeLessThanOrEqual(chunks[0].endLine);
      });

      it('should include file path and ID', async () => {
        const code = 'function test() {}';
        const chunks = await chunker.chunk(code, 'src/test.ts', 'file-123', defaultStrategy);

        expect(chunks[0].filePath).toBe('src/test.ts');
        expect(chunks[0].fileId).toBe('file-123');
      });

      it('should include hash', async () => {
        const code = 'function test() {}';
        const chunks = await chunker.chunk(code, 'test.ts', 'file-123', defaultStrategy);

        expect(chunks[0].hash).toBeDefined();
        expect(chunks[0].hash.length).toBe(64); // SHA-256 hex
      });

      it('should include token count', async () => {
        const code = 'function test() { return "hello world"; }';
        const chunks = await chunker.chunk(code, 'test.ts', 'file-123', defaultStrategy);

        expect(chunks[0].tokenCount).toBeGreaterThan(0);
      });
    });

    describe('grouping small declarations', () => {
      it('should group small declarations when enabled', async () => {
        const code = `
const A = 1;
const B = 2;
const C = 3;
const D = 4;
`;
        const chunksGrouped = await chunker.chunk(code, 'test.ts', 'file-123', {
          ...defaultStrategy,
          groupRelatedCode: true,
        });

        const chunksUngrouped = await chunker.chunk(code, 'test.ts', 'file-123', {
          ...defaultStrategy,
          groupRelatedCode: false,
        });

        // Grouped should have fewer or equal chunks
        expect(chunksGrouped.length).toBeLessThanOrEqual(chunksUngrouped.length);
      });
    });

    describe('large file handling', () => {
      it('should split large content that exceeds token limit', async () => {
        // Create a large function
        const largeFunction = `
function largeFunction() {
  ${Array(100).fill('  const x = "some long string value that takes up tokens";').join('\n')}
  return x;
}
`;
        const chunks = await chunker.chunk(largeFunction, 'test.ts', 'file-123', {
          ...defaultStrategy,
          maxChunkTokens: 100, // Low limit to force splitting
        });

        // Should have multiple chunks due to size
        expect(chunks.length).toBeGreaterThan(1);

        // Each chunk should be under the token limit (with some tolerance)
        for (const chunk of chunks) {
          expect(chunk.tokenCount).toBeLessThanOrEqual(150); // Allow some tolerance
        }
      });
    });

    describe('JavaScript support', () => {
      it('should chunk JavaScript files', async () => {
        const code = `
const express = require('express');

function createApp() {
  const app = express();
  app.get('/', (req, res) => res.send('Hello'));
  return app;
}

module.exports = { createApp };
`;
        const chunks = await chunker.chunk(code, 'app.js', 'file-123', {
          ...defaultStrategy,
          language: 'javascript',
        });

        expect(chunks.length).toBeGreaterThan(0);
      });
    });

    describe('TSX/JSX support', () => {
      it('should chunk TSX files', async () => {
        const code = `
import React from 'react';

interface Props {
  name: string;
}

export function Greeting({ name }: Props) {
  return <div>Hello, {name}!</div>;
}
`;
        const chunks = await chunker.chunk(code, 'Greeting.tsx', 'file-123', defaultStrategy);

        expect(chunks.length).toBeGreaterThan(0);
        const functionChunk = chunks.find((c) => c.name === 'Greeting');
        expect(functionChunk).toBeDefined();
      });
    });
  });

  describe('estimateTokens', () => {
    it('should estimate tokens for content', () => {
      const content = 'function test() { return "hello world"; }';
      const tokens = chunker.estimateTokens(content);

      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(50);
    });
  });
});
