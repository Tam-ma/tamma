/**
 * Tests for Generic Chunker
 */

import { describe, it, expect } from 'vitest';
import { GenericChunker } from '../chunking/generic-chunker.js';
import type { ChunkingStrategy } from '../types.js';

describe('GenericChunker', () => {
  let chunker: GenericChunker;

  beforeEach(() => {
    chunker = new GenericChunker();
  });

  describe('supportedLanguages', () => {
    it('should support multiple languages', () => {
      expect(chunker.supportedLanguages).toContain('python');
      expect(chunker.supportedLanguages).toContain('go');
      expect(chunker.supportedLanguages).toContain('rust');
      expect(chunker.supportedLanguages).toContain('java');
      expect(chunker.supportedLanguages).toContain('unknown');
    });
  });

  describe('chunk', () => {
    describe('Python', () => {
      const pythonStrategy: ChunkingStrategy = {
        language: 'python',
        parser: 'generic',
        maxChunkTokens: 512,
        overlapTokens: 50,
        preserveImports: true,
        groupRelatedCode: true,
      };

      it('should detect Python function definitions', async () => {
        const code = `
def hello():
    return "world"

def goodbye():
    return "farewell"
`;
        const chunks = await chunker.chunk(code, 'test.py', 'file-123', pythonStrategy);

        expect(chunks.length).toBeGreaterThan(0);
        const functionChunks = chunks.filter((c) => c.chunkType === 'function');
        expect(functionChunks.length).toBeGreaterThanOrEqual(1);
      });

      it('should detect Python class definitions', async () => {
        const code = `
class UserService:
    def __init__(self, db):
        self.db = db

    def get_user(self, user_id):
        return self.db.find(user_id)
`;
        const chunks = await chunker.chunk(code, 'test.py', 'file-123', pythonStrategy);

        const classChunks = chunks.filter((c) => c.chunkType === 'class');
        expect(classChunks.length).toBeGreaterThanOrEqual(1);
      });

      it('should handle async Python functions', async () => {
        const code = `
async def fetch_data():
    response = await client.get('/api/data')
    return response.json()
`;
        const chunks = await chunker.chunk(code, 'test.py', 'file-123', pythonStrategy);

        expect(chunks.length).toBeGreaterThan(0);
      });
    });

    describe('Go', () => {
      const goStrategy: ChunkingStrategy = {
        language: 'go',
        parser: 'generic',
        maxChunkTokens: 512,
        overlapTokens: 50,
        preserveImports: true,
        groupRelatedCode: true,
      };

      it('should detect Go function definitions', async () => {
        const code = `
func Hello() string {
    return "world"
}

func (s *Server) HandleRequest(w http.ResponseWriter, r *http.Request) {
    w.Write([]byte("OK"))
}
`;
        const chunks = await chunker.chunk(code, 'main.go', 'file-123', goStrategy);

        expect(chunks.length).toBeGreaterThan(0);
        const functionChunks = chunks.filter((c) => c.chunkType === 'function');
        expect(functionChunks.length).toBeGreaterThanOrEqual(1);
      });

      it('should detect Go struct definitions', async () => {
        const code = `
type User struct {
    ID   string
    Name string
    Age  int
}

type Server struct {
    addr string
    db   *Database
}
`;
        const chunks = await chunker.chunk(code, 'types.go', 'file-123', goStrategy);

        const classChunks = chunks.filter((c) => c.chunkType === 'class');
        expect(classChunks.length).toBeGreaterThanOrEqual(1);
      });

      it('should detect Go interface definitions', async () => {
        const code = `
type UserRepository interface {
    FindByID(id string) (*User, error)
    Save(user *User) error
    Delete(id string) error
}
`;
        const chunks = await chunker.chunk(code, 'repository.go', 'file-123', goStrategy);

        const interfaceChunks = chunks.filter((c) => c.chunkType === 'interface');
        expect(interfaceChunks.length).toBeGreaterThanOrEqual(1);
      });
    });

    describe('Rust', () => {
      const rustStrategy: ChunkingStrategy = {
        language: 'rust',
        parser: 'generic',
        maxChunkTokens: 512,
        overlapTokens: 50,
        preserveImports: true,
        groupRelatedCode: true,
      };

      it('should detect Rust function definitions', async () => {
        const code = `
fn hello() -> String {
    String::from("world")
}

pub fn public_function() -> i32 {
    42
}

pub async fn async_fetch() -> Result<String, Error> {
    Ok(String::new())
}
`;
        const chunks = await chunker.chunk(code, 'lib.rs', 'file-123', rustStrategy);

        expect(chunks.length).toBeGreaterThan(0);
        const functionChunks = chunks.filter((c) => c.chunkType === 'function');
        expect(functionChunks.length).toBeGreaterThanOrEqual(1);
      });

      it('should detect Rust struct definitions', async () => {
        const code = `
struct User {
    id: String,
    name: String,
}

pub struct PublicStruct {
    field: i32,
}
`;
        const chunks = await chunker.chunk(code, 'models.rs', 'file-123', rustStrategy);

        const classChunks = chunks.filter((c) => c.chunkType === 'class');
        expect(classChunks.length).toBeGreaterThanOrEqual(1);
      });

      it('should detect Rust trait definitions', async () => {
        const code = `
pub trait Repository {
    fn find_by_id(&self, id: &str) -> Option<User>;
    fn save(&mut self, user: User) -> Result<(), Error>;
}
`;
        const chunks = await chunker.chunk(code, 'traits.rs', 'file-123', rustStrategy);

        const interfaceChunks = chunks.filter((c) => c.chunkType === 'interface');
        expect(interfaceChunks.length).toBeGreaterThanOrEqual(1);
      });

      it('should detect Rust enum definitions', async () => {
        const code = `
pub enum Status {
    Pending,
    Active,
    Completed,
}
`;
        const chunks = await chunker.chunk(code, 'status.rs', 'file-123', rustStrategy);

        const enumChunks = chunks.filter((c) => c.chunkType === 'enum');
        expect(enumChunks.length).toBeGreaterThanOrEqual(1);
      });
    });

    describe('Java', () => {
      const javaStrategy: ChunkingStrategy = {
        language: 'java',
        parser: 'generic',
        maxChunkTokens: 512,
        overlapTokens: 50,
        preserveImports: true,
        groupRelatedCode: true,
      };

      it('should detect Java class definitions', async () => {
        const code = `
public class UserService {
    private final Database db;

    public UserService(Database db) {
        this.db = db;
    }

    public User getUser(String id) {
        return db.findUser(id);
    }
}
`;
        const chunks = await chunker.chunk(code, 'UserService.java', 'file-123', javaStrategy);

        const classChunks = chunks.filter((c) => c.chunkType === 'class');
        expect(classChunks.length).toBeGreaterThanOrEqual(1);
      });

      it('should detect Java interface definitions', async () => {
        const code = `
public interface UserRepository {
    User findById(String id);
    void save(User user);
    void delete(String id);
}
`;
        const chunks = await chunker.chunk(code, 'UserRepository.java', 'file-123', javaStrategy);

        const interfaceChunks = chunks.filter((c) => c.chunkType === 'interface');
        expect(interfaceChunks.length).toBeGreaterThanOrEqual(1);
      });

      it('should detect Java enum definitions', async () => {
        const code = `
public enum Status {
    PENDING,
    ACTIVE,
    COMPLETED
}
`;
        const chunks = await chunker.chunk(code, 'Status.java', 'file-123', javaStrategy);

        const enumChunks = chunks.filter((c) => c.chunkType === 'enum');
        expect(enumChunks.length).toBeGreaterThanOrEqual(1);
      });
    });

    describe('Unknown language', () => {
      const unknownStrategy: ChunkingStrategy = {
        language: 'unknown',
        parser: 'generic',
        maxChunkTokens: 512,
        overlapTokens: 50,
        preserveImports: false,
        groupRelatedCode: false,
      };

      it('should fall back to sliding window for unknown languages', async () => {
        const code = `
This is some content
that doesn't match any
known language patterns
but should still be chunked
`;
        const chunks = await chunker.chunk(code, 'test.txt', 'file-123', unknownStrategy);

        expect(chunks.length).toBeGreaterThan(0);
        expect(chunks[0].chunkType).toBe('block');
      });
    });

    describe('large content handling', () => {
      it('should split large content that exceeds token limit', async () => {
        const largeContent = Array(200).fill('line of code with some content here').join('\n');

        const chunks = await chunker.chunk(largeContent, 'test.py', 'file-123', {
          language: 'python',
          parser: 'generic',
          maxChunkTokens: 100,
          overlapTokens: 20,
          preserveImports: false,
          groupRelatedCode: false,
        });

        expect(chunks.length).toBeGreaterThan(1);

        // Each chunk should be under the token limit (with tolerance)
        for (const chunk of chunks) {
          expect(chunk.tokenCount).toBeLessThanOrEqual(150);
        }
      });
    });

    describe('chunk metadata', () => {
      it('should include correct metadata', async () => {
        const code = `
def hello():
    return "world"
`;
        const chunks = await chunker.chunk(code, 'src/utils.py', 'file-123', {
          language: 'python',
          parser: 'generic',
          maxChunkTokens: 512,
          overlapTokens: 50,
          preserveImports: true,
          groupRelatedCode: true,
        });

        expect(chunks[0].filePath).toBe('src/utils.py');
        expect(chunks[0].fileId).toBe('file-123');
        expect(chunks[0].language).toBe('python');
        expect(chunks[0].hash).toBeDefined();
        expect(chunks[0].tokenCount).toBeGreaterThan(0);
      });
    });
  });

  describe('estimateTokens', () => {
    it('should estimate tokens for content', () => {
      const content = 'def hello():\n    return "world"';
      const tokens = chunker.estimateTokens(content);

      expect(tokens).toBeGreaterThan(0);
    });
  });
});
