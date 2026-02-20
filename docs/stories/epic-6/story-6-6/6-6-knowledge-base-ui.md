# Story 6-6: Knowledge Base Management UI

## User Story

As a **Tamma administrator**, I need a dashboard to manage the knowledge base so that I can monitor indexing status, configure sources, search the index, and troubleshoot context retrieval issues.

## Description

Implement a web-based dashboard for managing the knowledge base infrastructure including vector database status, RAG pipeline configuration, MCP server connections, indexing jobs, and context retrieval testing.

## Acceptance Criteria

### AC1: Index Management Dashboard
- [ ] View indexing status (last run, files indexed, chunks created)
- [ ] Trigger manual re-index
- [ ] View indexing history and logs
- [ ] Configure indexing schedule
- [ ] View/edit include/exclude patterns

### AC2: Vector Database Monitor
- [ ] Display collection statistics (size, vector count)
- [ ] Monitor query performance metrics
- [ ] View storage usage
- [ ] Test similarity search
- [ ] Collection management (create, delete)

### AC3: RAG Pipeline Configuration
- [ ] Configure source weights and priorities
- [ ] Adjust ranking parameters
- [ ] Set token budgets
- [ ] View pipeline metrics
- [ ] Test RAG queries

### AC4: MCP Server Management
- [ ] View connected servers and status
- [ ] Start/stop/restart servers
- [ ] View available tools per server
- [ ] Test tool invocations
- [ ] View server logs

### AC5: Context Testing Interface
- [ ] Interactive query testing
- [ ] View retrieved context with highlighting
- [ ] Compare context from different sources
- [ ] Measure retrieval latency
- [ ] Provide relevance feedback

### AC6: Configuration Editor
- [ ] Edit all context layer configurations
- [ ] Validate configuration changes
- [ ] Preview configuration effects
- [ ] Version control for configs
- [ ] Import/export configurations

### AC7: Analytics & Reporting
- [ ] Context retrieval analytics
- [ ] Token usage reports
- [ ] Source contribution breakdown
- [ ] Quality metrics over time
- [ ] Cost analysis

## Technical Design

### Dashboard Pages

```
/knowledge-base
├── /index          # Index management
│   ├── /status     # Current status
│   ├── /history    # Indexing history
│   └── /config     # Index configuration
├── /vector-db      # Vector database
│   ├── /collections
│   ├── /metrics
│   └── /search     # Test search
├── /rag            # RAG pipeline
│   ├── /config
│   ├── /test
│   └── /metrics
├── /mcp            # MCP servers
│   ├── /servers
│   ├── /tools
│   └── /logs
├── /test           # Context testing
└── /analytics      # Reports
```

### API Endpoints

```typescript
// Index Management
GET    /api/knowledge-base/index/status
POST   /api/knowledge-base/index/trigger
GET    /api/knowledge-base/index/history
PUT    /api/knowledge-base/index/config

// Vector Database
GET    /api/knowledge-base/vector-db/collections
GET    /api/knowledge-base/vector-db/collections/:name/stats
DELETE /api/knowledge-base/vector-db/collections/:name
POST   /api/knowledge-base/vector-db/search

// RAG Pipeline
GET    /api/knowledge-base/rag/config
PUT    /api/knowledge-base/rag/config
POST   /api/knowledge-base/rag/test
GET    /api/knowledge-base/rag/metrics

// MCP Servers
GET    /api/knowledge-base/mcp/servers
POST   /api/knowledge-base/mcp/servers/:name/start
POST   /api/knowledge-base/mcp/servers/:name/stop
GET    /api/knowledge-base/mcp/servers/:name/tools
POST   /api/knowledge-base/mcp/servers/:name/tools/:tool/invoke
GET    /api/knowledge-base/mcp/servers/:name/logs

// Context Testing
POST   /api/knowledge-base/context/test
POST   /api/knowledge-base/context/feedback

// Analytics
GET    /api/knowledge-base/analytics/usage
GET    /api/knowledge-base/analytics/quality
GET    /api/knowledge-base/analytics/costs
```

### UI Components

```typescript
// Index Status Card
interface IndexStatusCardProps {
  status: 'idle' | 'indexing' | 'error';
  lastRun: Date;
  filesIndexed: number;
  chunksCreated: number;
  progress?: number;
  onTriggerIndex: () => void;
}

// Vector Search Test
interface VectorSearchTestProps {
  collections: string[];
  onSearch: (query: string, collection: string, topK: number) => Promise<SearchResult[]>;
}

// MCP Server Card
interface MCPServerCardProps {
  server: {
    name: string;
    status: 'connected' | 'disconnected' | 'error';
    transport: 'stdio' | 'sse';
    toolCount: number;
    resourceCount: number;
  };
  onStart: () => void;
  onStop: () => void;
  onViewTools: () => void;
}

// Context Test Interface
interface ContextTestProps {
  onTest: (query: string, options: ContextOptions) => Promise<ContextResult>;
  onFeedback: (resultId: string, feedback: Feedback) => void;
}

// Retrieved Context Viewer
interface ContextViewerProps {
  context: AssembledContext;
  highlightQuery?: string;
  showSources: boolean;
  showScores: boolean;
}
```

### Dashboard Layout

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  TAMMA KNOWLEDGE BASE                                              [Settings] │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │  QUICK STATUS                                                             │  │
│  │                                                                           │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐         │  │
│  │  │   INDEX    │  │  VECTOR DB │  │    RAG     │  │    MCP     │         │  │
│  │  │            │  │            │  │            │  │            │         │  │
│  │  │  ✓ Healthy │  │  ✓ Healthy │  │  ✓ Healthy │  │  3/4 Up    │         │  │
│  │  │  45.2k     │  │  128k      │  │  p95: 89ms │  │  12 tools  │         │  │
│  │  │  chunks    │  │  vectors   │  │            │  │            │         │  │
│  │  └────────────┘  └────────────┘  └────────────┘  └────────────┘         │  │
│  │                                                                           │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │  CONTEXT TEST                                                             │  │
│  │                                                                           │  │
│  │  Query: [How does authentication work in this codebase?        ] [Test]  │  │
│  │                                                                           │  │
│  │  Options: [✓] Vector DB  [✓] RAG  [✓] MCP  [ ] Web Search               │  │
│  │           Max Tokens: [4000]  Task Type: [Implementation ▼]              │  │
│  │                                                                           │  │
│  │  ──────────────────────────────────────────────────────────────────────  │  │
│  │                                                                           │  │
│  │  Results (8 chunks, 3,456 tokens, 124ms)                                 │  │
│  │                                                                           │  │
│  │  ┌─────────────────────────────────────────────────────────────────────┐│  │
│  │  │ 1. src/auth/jwt.ts:15-45                          [Vector] 0.94    ││  │
│  │  │    export class JWTService {                                        ││  │
│  │  │      async validateToken(token: string): Promise<User> {            ││  │
│  │  │        // ...                                                       ││  │
│  │  │      }                                                              ││  │
│  │  │    }                                                                ││  │
│  │  │                                                    [👍] [👎]        ││  │
│  │  └─────────────────────────────────────────────────────────────────────┘│  │
│  │                                                                           │  │
│  │  ┌─────────────────────────────────────────────────────────────────────┐│  │
│  │  │ 2. src/middleware/auth.ts:1-30                    [Vector] 0.89    ││  │
│  │  │    // Authentication middleware                                     ││  │
│  │  │    export const authMiddleware = ...                                ││  │
│  │  │                                                    [👍] [👎]        ││  │
│  │  └─────────────────────────────────────────────────────────────────────┘│  │
│  │                                                                           │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │  SOURCE CONTRIBUTIONS                                                     │  │
│  │                                                                           │  │
│  │  Vector DB  ████████████████████████████░░  72% (2,490 tokens)           │  │
│  │  RAG        ████████░░░░░░░░░░░░░░░░░░░░░░  21% (725 tokens)             │  │
│  │  MCP        ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░   7% (241 tokens)             │  │
│  │                                                                           │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Dependencies

- Story 6-1: Codebase Indexer (indexing status)
- Story 6-2: Vector Database (collection management)
- Story 6-3: RAG Pipeline (configuration, testing)
- Story 6-4: MCP Client (server management)
- Story 6-5: Context Aggregator (testing interface)
- Epic 5: Dashboard infrastructure

## Testing Strategy

### Unit Tests
- Component rendering
- API response handling
- Configuration validation

### Integration Tests
- API endpoint coverage
- Real-time status updates
- Configuration persistence

### E2E Tests
- Full workflows (index, search, test)
- MCP server management
- Configuration changes

## Success Metrics

- Dashboard load time < 2 seconds
- Real-time updates within 1 second
- Configuration changes apply within 5 seconds
- User satisfaction > 4/5 (usability survey)
