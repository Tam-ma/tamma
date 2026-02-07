# Tamma Engine Architecture

## System Overview - Manager as Main Interface

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              TAMMA MANAGER                                       │
│  (Main Interface - Oversees All Projects)                                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐     │
│  │   Project A  │   │   Project B  │   │   Project C  │   │   Project N  │     │
│  │   Engine     │   │   Engine     │   │   Engine     │   │   Engine     │     │
│  │   Instance   │   │   Instance   │   │   Instance   │   │   Instance   │     │
│  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘   └──────┬───────┘     │
│         │                  │                  │                  │              │
│         └──────────────────┴─────────┬────────┴──────────────────┘              │
│                                      │                                          │
│  ┌───────────────────────────────────┴────────────────────────────────────┐    │
│  │                        EVENT BUS / MESSAGE QUEUE                        │    │
│  └────────────────────────────────────────────────────────────────────────┘    │
│                                      │                                          │
│         ┌────────────────────────────┼────────────────────────────┐            │
│         ▼                            ▼                            ▼            │
│  ┌──────────────┐          ┌──────────────────┐          ┌──────────────┐     │
│  │   MONITOR    │          │   LLM INTERFACE  │          │    ALERT     │     │
│  │   Service    │          │   (User Chat)    │          │   MANAGER    │     │
│  │              │          │                  │          │              │     │
│  │ • Health     │          │ • Natural Lang.  │          │ • Triggers   │     │
│  │ • Metrics    │          │ • Status Query   │          │ • Channels   │     │
│  │ • Dashboard  │          │ • Commands       │          │ • Rate Limit │     │
│  └──────────────┘          └──────────────────┘          └──────────────┘     │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Multi-Agent Architecture

### Agent Hierarchy

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           TAMMA SYSTEM (Global)                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                         AGENT REGISTRY                                   │   │
│  │                                                                          │   │
│  │   Role: ARCHITECT                  Role: RESEARCHER                     │   │
│  │   ┌─────────────────────────┐     ┌─────────────────────────┐          │   │
│  │   │ Agent Pool              │     │ Agent Pool              │          │   │
│  │   │ ┌───┐ ┌───┐ ┌───┐      │     │ ┌───┐ ┌───┐ ┌───┐      │          │   │
│  │   │ │AR1│ │AR2│ │AR3│ ...  │     │ │RS1│ │RS2│ │RS3│ ...  │          │   │
│  │   │ └───┘ └───┘ └───┘      │     │ └───┘ └───┘ └───┘      │          │   │
│  │   │ Provider: Claude Opus   │     │ Provider: Claude+Web    │          │   │
│  │   │ Model: opus             │     │ + WebSearch, Perplexity │          │   │
│  │   └─────────────────────────┘     └─────────────────────────┘          │   │
│  │                                                                          │   │
│  │   Role: ANALYST                    Role: PLANNER                        │   │
│  │   ┌─────────────────────────┐     ┌─────────────────────────┐          │   │
│  │   │ Agent Pool              │     │ Agent Pool              │          │   │
│  │   │ ┌───┐ ┌───┐ ┌───┐      │     │ ┌───┐ ┌───┐ ┌───┐      │          │   │
│  │   │ │AN1│ │AN2│ │AN3│ ...  │     │ │PL1│ │PL2│ │PL3│ ...  │          │   │
│  │   │ └───┘ └───┘ └───┘      │     │ └───┘ └───┘ └───┘      │          │   │
│  │   │ Provider: OpenRouter    │     │ Provider: Claude API    │          │   │
│  │   │ Model: claude-3.5       │     │ Model: claude-sonnet    │          │   │
│  │   └─────────────────────────┘     └─────────────────────────┘          │   │
│  │                                                                          │   │
│  │   Role: IMPLEMENTER                Role: REVIEWER                       │   │
│  │   ┌─────────────────────────┐     ┌─────────────────────────┐          │   │
│  │   │ Agent Pool              │     │ Agent Pool              │          │   │
│  │   │ ┌───┐ ┌───┐ ┌───┐      │     │ ┌───┐ ┌───┐ ┌───┐      │          │   │
│  │   │ │IM1│ │IM2│ │IM3│ ...  │     │ │RV1│ │RV2│ │RV3│ ...  │          │   │
│  │   │ └───┘ └───┘ └───┘      │     │ └───┘ └───┘ └───┘      │          │   │
│  │   │ Provider: Claude Code   │     │ Provider: OpenRouter    │          │   │
│  │   │ CLI: claude -p          │     │ Model: gpt-4o           │          │   │
│  │   └─────────────────────────┘     └─────────────────────────┘          │   │
│  │                                                                          │   │
│  │   Role: TESTER                     Role: DOCUMENTER                     │   │
│  │   ┌─────────────────────────┐     ┌─────────────────────────┐          │   │
│  │   │ Agent Pool              │     │ Agent Pool              │          │   │
│  │   │ ┌───┐ ┌───┐ ┌───┐      │     │ ┌───┐ ┌───┐ ┌───┐      │          │   │
│  │   │ │TS1│ │TS2│ │TS3│ ...  │     │ │DC1│ │DC2│ │DC3│ ...  │          │   │
│  │   │ └───┘ └───┘ └───┘      │     │ └───┘ └───┘ └───┘      │          │   │
│  │   │ Provider: Claude Code   │     │ Provider: Gemini        │          │   │
│  │   │ CLI: claude -p          │     │ Model: gemini-flash     │          │   │
│  │   └─────────────────────────┘     └─────────────────────────┘          │   │
│  │                                                                          │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Agent Roles

| Role | Purpose | Provider Type | Scope | Example Providers |
|------|---------|---------------|-------|-------------------|
| **SCRUM_MASTER** | Project coordination, prioritization, user interaction | ILLMProvider | 1 per Project | Claude Opus, GPT-4o |
| **ARCHITECT** | System design, technical decisions, code standards | ILLMProvider | Pool | Claude Opus, GPT-4o |
| **RESEARCHER** | Information gathering, docs lookup, API exploration | ILLMProvider + Web | Pool | Claude + WebSearch, Perplexity |
| **ANALYST** | Issue context analysis | ILLMProvider | Pool | OpenRouter, Claude API |
| **PLANNER** | Development plan generation | ILLMProvider | Pool | Claude API |
| **IMPLEMENTER** | Code generation & execution | ICLIAgentProvider | Pool | Claude Code, OpenCode |
| **REVIEWER** | Code review & quality check | ILLMProvider | Pool | GPT-4o, Claude |
| **TESTER** | Test generation & execution | ICLIAgentProvider | Pool | Claude Code |
| **DOCUMENTER** | Documentation generation | ILLMProvider | Pool | Gemini Flash |

### Scrum Master (Per Project)

> **See:** [Story 6-10: Scrum Master Task Loop](../stories/epic-6/story-6-10/6-10-scrum-master-task-loop.md)

The Scrum Master is a dedicated agent per project that:
- **Owns the project context** - understands codebase, conventions, history
- **Prioritizes issues** - decides which issues to work on next
- **Coordinates engines** - assigns work to available engine instances
- **Communicates with users** - answers questions, provides status updates
- **Escalates blockers** - alerts when issues need human intervention
- **Reviews plans** - approves/rejects plans before implementation
- **Maintains velocity** - tracks metrics, suggests process improvements
- **Captures learnings** - records what worked/failed for future tasks

#### Scrum Master Task Loop State Machine

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     SCRUM MASTER TASK LOOP                                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   ┌────────┐                                                                    │
│   │RECEIVE │                                                                    │
│   │ TASK   │                                                                    │
│   └───┬────┘                                                                    │
│       │                                                                         │
│       ▼                                                                         │
│   ┌────────┐     Check KB      ┌────────────┐                                  │
│   │  PLAN  │────────────────►  │  APPROVE   │                                  │
│   │        │                   │            │                                  │
│   │Research│                   │• Validate  │                                  │
│   │Generate│                   │• Risk check│                                  │
│   └────────┘                   │• Get OK    │                                  │
│                                └─────┬──────┘                                  │
│                                      │                                          │
│                   ┌──────────────────┼──────────────────┐                      │
│                   │                  │                  │                      │
│                   ▼                  ▼                  ▼                      │
│            ┌──────────┐       ┌──────────┐       ┌──────────┐                 │
│            │ BLOCKED  │       │ APPROVED │       │ NEED     │                 │
│            │          │       │          │       │ APPROVAL │                 │
│            └────┬─────┘       └────┬─────┘       └────┬─────┘                 │
│                 │                  │                  │                        │
│                 ▼                  ▼                  ▼                        │
│            ┌──────────┐       ┌──────────┐       ┌──────────┐                 │
│            │  ALERT   │       │IMPLEMENT │       │  ALERT   │                 │
│            │          │       │          │       │  (wait)  │                 │
│            │• Notify  │       │• Assign  │       └────┬─────┘                 │
│            │• Escalate│       │  engine  │            │                        │
│            └──────────┘       │• Monitor │            │ user approves          │
│                               └────┬─────┘            │                        │
│                                    │                  │                        │
│                                    ▼                  │                        │
│                               ┌──────────┐            │                        │
│                               │  REVIEW  │◄───────────┘                        │
│                               │          │                                     │
│                               │• Quality │                                     │
│                               │• Tests   │                                     │
│                               │• Check KB│                                     │
│                               └────┬─────┘                                     │
│                                    │                                           │
│                   ┌────────────────┼────────────────┐                         │
│                   │                │                │                         │
│                   ▼                ▼                ▼                         │
│            ┌──────────┐     ┌──────────┐     ┌──────────┐                    │
│            │  PASSED  │     │  FAILED  │     │ MAX      │                    │
│            └────┬─────┘     └────┬─────┘     │ RETRIES  │                    │
│                 │                │           └────┬─────┘                    │
│                 │                │                │                          │
│                 │                ▼                ▼                          │
│                 │          ┌──────────┐     ┌──────────┐                    │
│                 │          │  ADJUST  │     │  ALERT   │                    │
│                 │          │   PLAN   │     │          │                    │
│                 │          └────┬─────┘     │• Escalate│                    │
│                 │               │           │• Human   │                    │
│                 │               └───────────┤  review  │                    │
│                 │                    retry  └──────────┘                    │
│                 ▼                                                            │
│            ┌──────────┐                                                     │
│            │  LEARN   │                                                     │
│            │          │                                                     │
│            │• Capture │                                                     │
│            │• Update  │                                                     │
│            │  KB      │                                                     │
│            └────┬─────┘                                                     │
│                 │                                                           │
│                 ▼                                                           │
│            ┌──────────┐                                                     │
│            │ COMPLETE │                                                     │
│            │          │                                                     │
│            │• Close   │                                                     │
│            │• Report  │                                                     │
│            └──────────┘                                                     │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### Pre-Task Knowledge Check

Before any task, the Scrum Master checks:

1. **Recommendations** - Best practices to follow
2. **Prohibited Actions** - Things to avoid
3. **Learnings** - Insights from past tasks

```
Task Request
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│              KNOWLEDGE BASE CHECK                        │
│                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │Recommendations│ │Prohibitions │ │  Learnings  │     │
│  │             │  │             │  │             │     │
│  │• Best       │  │• Blocked    │  │• Past       │     │
│  │  practices  │  │  patterns   │  │  successes  │     │
│  │• Standards  │  │• Anti-      │  │• Past       │     │
│  │• Preferred  │  │  patterns   │  │  failures   │     │
│  │  approaches │  │• Security   │  │• What       │     │
│  │             │  │  rules      │  │  worked     │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
│                                                          │
│  Result:                                                │
│  ├── Blockers (critical) ──► STOP                      │
│  ├── Warnings ──► Proceed with caution                 │
│  └── Suggestions ──► Enhance plan                      │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         SCRUM MASTER (Per Project)                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   Project: owner/repo-a                                                         │
│   ┌───────────────────────────────────────────────────────────────────────────┐│
│   │                                                                            ││
│   │   SCRUM MASTER AGENT                                                      ││
│   │   ┌────────────────────────────────────────────────────────────────────┐ ││
│   │   │                                                                     │ ││
│   │   │   Responsibilities:                                                │ ││
│   │   │   ├── Maintain project knowledge base                              │ ││
│   │   │   ├── Triage incoming issues                                       │ ││
│   │   │   ├── Prioritize backlog                                           │ ││
│   │   │   ├── Assign issues to engines                                     │ ││
│   │   │   ├── Review & approve plans                                       │ ││
│   │   │   ├── Monitor engine progress                                      │ ││
│   │   │   ├── Handle user queries via LLM chat                             │ ││
│   │   │   ├── Escalate blockers to humans                                  │ ││
│   │   │   └── Report metrics & velocity                                    │ ││
│   │   │                                                                     │ ││
│   │   │   State:                                                           │ ││
│   │   │   ├── project_config                                               │ ││
│   │   │   ├── codebase_summary                                             │ ││
│   │   │   ├── active_engines[]                                             │ ││
│   │   │   ├── issue_queue[]                                                │ ││
│   │   │   ├── completed_issues[]                                           │ ││
│   │   │   └── conversation_history[]                                       │ ││
│   │   │                                                                     │ ││
│   │   └────────────────────────────────────────────────────────────────────┘ ││
│   │                                                                            ││
│   │         │                    │                    │                       ││
│   │         ▼                    ▼                    ▼                       ││
│   │   ┌──────────┐         ┌──────────┐         ┌──────────┐                 ││
│   │   │ Engine 1 │         │ Engine 2 │         │ Engine 3 │                 ││
│   │   │ Issue #42│         │ Issue #43│         │ Issue #44│                 ││
│   │   └──────────┘         └──────────┘         └──────────┘                 ││
│   │                                                                            ││
│   └───────────────────────────────────────────────────────────────────────────┘│
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Context Sources (Future) - Epic 6

> **See:** [Epic 6: Context & Knowledge Management](../stories/epic-6/README.md)
>
> - [Story 6-1: Codebase Indexer](../stories/epic-6/story-6-1/6-1-codebase-indexer.md)
> - [Story 6-2: Vector Database Integration](../stories/epic-6/story-6-2/6-2-vector-database-integration.md)
> - [Story 6-3: RAG Pipeline](../stories/epic-6/story-6-3/6-3-rag-pipeline.md)
> - [Story 6-4: MCP Client Integration](../stories/epic-6/story-6-4/6-4-mcp-client-integration.md)
> - [Story 6-5: Context Aggregator](../stories/epic-6/story-6-5/6-5-context-aggregator.md)
> - [Story 6-6: Knowledge Base UI](../stories/epic-6/story-6-6/6-6-knowledge-base-ui.md)

The system supports multiple methods for gathering context information:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         CONTEXT LAYER (Future)                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   ┌─────────────────────────────────────────────────────────────────────────┐  │
│   │                        CONTEXT AGGREGATOR                                │  │
│   │                                                                          │  │
│   │   Combines context from multiple sources before passing to agents       │  │
│   │                                                                          │  │
│   └─────────────────────────────────────────────────────────────────────────┘  │
│                          │                                                      │
│         ┌────────────────┼────────────────┬────────────────┐                   │
│         ▼                ▼                ▼                ▼                   │
│   ┌───────────┐    ┌───────────┐    ┌───────────┐    ┌───────────┐            │
│   │  VECTOR   │    │    RAG    │    │    MCP    │    │   LIVE    │            │
│   │    DB     │    │  SYSTEM   │    │  SERVERS  │    │  SOURCES  │            │
│   │           │    │           │    │           │    │           │            │
│   │ • Code    │    │ • Docs    │    │ • GitHub  │    │ • Web     │            │
│   │   embeddings   │ • PRs     │    │ • Slack   │    │ • APIs    │            │
│   │ • Semantic│    │ • Issues  │    │ • Jira    │    │ • Search  │            │
│   │   search  │    │ • Wiki    │    │ • Custom  │    │           │            │
│   └───────────┘    └───────────┘    └───────────┘    └───────────┘            │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### 1. Vector Database (Codebase Indexing)

Index the entire codebase for semantic search:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         CODEBASE INDEXER                                         │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   Source Files                    Indexing Pipeline                             │
│   ┌─────────────┐                                                               │
│   │ *.ts        │ ──┐                                                           │
│   │ *.tsx       │   │         ┌──────────────┐    ┌──────────────┐             │
│   │ *.js        │   ├────────►│   CHUNKER    │───►│  EMBEDDER    │             │
│   │ *.py        │   │         │              │    │              │             │
│   │ *.md        │   │         │ • Functions  │    │ • OpenAI     │             │
│   │ *.json      │ ──┘         │ • Classes    │    │ • Cohere     │             │
│   └─────────────┘             │ • Blocks     │    │ • Local      │             │
│                               │ • Semantic   │    │   (Ollama)   │             │
│                               └──────────────┘    └──────┬───────┘             │
│                                                          │                      │
│                                                          ▼                      │
│                               ┌──────────────────────────────────────────────┐ │
│                               │              VECTOR DATABASE                  │ │
│                               │                                               │ │
│                               │  Providers:                                   │ │
│                               │  • Pinecone (cloud)                           │ │
│                               │  • Weaviate (self-hosted)                     │ │
│                               │  • Qdrant (self-hosted)                       │ │
│                               │  • ChromaDB (local/embedded)                  │ │
│                               │  • pgvector (PostgreSQL extension)            │ │
│                               │                                               │ │
│                               │  Indexed Content:                             │ │
│                               │  • file_path, chunk_id, content               │ │
│                               │  • embedding vector (1536+ dims)              │ │
│                               │  • metadata (language, symbols, imports)      │ │
│                               │                                               │ │
│                               └──────────────────────────────────────────────┘ │
│                                                                                  │
│   Queries:                                                                      │
│   ┌───────────────────────────────────────────────────────────────────────────┐│
│   │                                                                            ││
│   │  "Find code that handles user authentication"                             ││
│   │       │                                                                    ││
│   │       ▼                                                                    ││
│   │  Embed query ──► Similarity search ──► Top K results ──► Context         ││
│   │                                                                            ││
│   │  Returns:                                                                  ││
│   │  • src/auth/jwt.ts:15-45 (score: 0.92)                                    ││
│   │  • src/middleware/auth.ts:1-30 (score: 0.87)                              ││
│   │  • src/routes/login.ts:20-60 (score: 0.84)                                ││
│   │                                                                            ││
│   └───────────────────────────────────────────────────────────────────────────┘│
│                                                                                  │
│   Triggers for Re-indexing:                                                     │
│   • Git push/merge to main                                                      │
│   • Scheduled (nightly)                                                         │
│   • Manual trigger                                                              │
│   • File change detection (watch mode)                                          │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### 2. RAG System (Retrieval Augmented Generation)

Enhance agent responses with retrieved context:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         RAG PIPELINE                                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   ┌─────────────────────────────────────────────────────────────────────────┐  │
│   │                                                                          │  │
│   │   Agent Query: "Implement user logout functionality"                    │  │
│   │                                                                          │  │
│   └─────────────────────────────────────────────────┬────────────────────────┘  │
│                                                     │                           │
│                                                     ▼                           │
│   ┌─────────────────────────────────────────────────────────────────────────┐  │
│   │                        RETRIEVAL STAGE                                   │  │
│   │                                                                          │  │
│   │   1. Vector Search (codebase)                                           │  │
│   │      └── "logout", "session", "auth" → relevant code chunks             │  │
│   │                                                                          │  │
│   │   2. Keyword Search (issues, PRs, docs)                                 │  │
│   │      └── BM25 search for "logout" in past issues                        │  │
│   │                                                                          │  │
│   │   3. Graph Traversal (dependencies)                                     │  │
│   │      └── Find files that import auth modules                            │  │
│   │                                                                          │  │
│   │   4. Recency Filter                                                     │  │
│   │      └── Prioritize recently modified files                             │  │
│   │                                                                          │  │
│   └─────────────────────────────────────────────────┬────────────────────────┘  │
│                                                     │                           │
│                                                     ▼                           │
│   ┌─────────────────────────────────────────────────────────────────────────┐  │
│   │                        CONTEXT ASSEMBLY                                  │  │
│   │                                                                          │  │
│   │   Retrieved chunks ranked by relevance:                                 │  │
│   │   ┌─────────────────────────────────────────────────────────────────┐  │  │
│   │   │ 1. src/auth/session.ts (score: 0.94)                            │  │  │
│   │   │ 2. src/routes/auth.ts (score: 0.89)                             │  │  │
│   │   │ 3. PR #234: "Add session timeout" (score: 0.85)                 │  │  │
│   │   │ 4. Issue #189: "Logout doesn't clear cookies" (score: 0.82)     │  │  │
│   │   │ 5. docs/auth.md (score: 0.78)                                   │  │  │
│   │   └─────────────────────────────────────────────────────────────────┘  │  │
│   │                                                                          │  │
│   │   Token budget: 8000 tokens                                             │  │
│   │   Assembled context: 6234 tokens                                        │  │
│   │                                                                          │  │
│   └─────────────────────────────────────────────────┬────────────────────────┘  │
│                                                     │                           │
│                                                     ▼                           │
│   ┌─────────────────────────────────────────────────────────────────────────┐  │
│   │                        AUGMENTED PROMPT                                  │  │
│   │                                                                          │  │
│   │   System: You are implementing logout functionality...                  │  │
│   │                                                                          │  │
│   │   Context:                                                              │  │
│   │   <retrieved_code>...</retrieved_code>                                  │  │
│   │   <related_issues>...</related_issues>                                  │  │
│   │   <documentation>...</documentation>                                    │  │
│   │                                                                          │  │
│   │   Task: Implement user logout functionality                             │  │
│   │                                                                          │  │
│   └─────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### 3. MCP Servers (Model Context Protocol)

Connect to external tools and data sources:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         MCP INTEGRATION                                          │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   ┌─────────────────────────────────────────────────────────────────────────┐  │
│   │                        MCP CLIENT (in Tamma)                             │  │
│   │                                                                          │  │
│   │   Connects to multiple MCP servers for rich context                     │  │
│   │                                                                          │  │
│   └─────────────────────────────────────────────────────────────────────────┘  │
│                          │                                                      │
│         ┌────────────────┼────────────────┬────────────────┐                   │
│         ▼                ▼                ▼                ▼                   │
│   ┌───────────┐    ┌───────────┐    ┌───────────┐    ┌───────────┐            │
│   │  GitHub   │    │   Slack   │    │   Jira    │    │  Custom   │            │
│   │   MCP     │    │   MCP     │    │   MCP     │    │   MCP     │            │
│   │           │    │           │    │           │    │           │            │
│   │ • Issues  │    │ • Channels│    │ • Tickets │    │ • Internal│            │
│   │ • PRs     │    │ • Messages│    │ • Sprints │    │   APIs    │            │
│   │ • Actions │    │ • Threads │    │ • Epics   │    │ • DBs     │            │
│   │ • Files   │    │ • Users   │    │ • Comments│    │ • Services│            │
│   └───────────┘    └───────────┘    └───────────┘    └───────────┘            │
│                                                                                  │
│   MCP Server Configuration:                                                     │
│   ┌───────────────────────────────────────────────────────────────────────────┐│
│   │                                                                            ││
│   │   mcp_servers:                                                            ││
│   │     - name: github                                                        ││
│   │       transport: stdio                                                    ││
│   │       command: npx @modelcontextprotocol/server-github                    ││
│   │       env:                                                                ││
│   │         GITHUB_TOKEN: ${GITHUB_TOKEN}                                     ││
│   │                                                                            ││
│   │     - name: slack                                                         ││
│   │       transport: sse                                                      ││
│   │       url: http://localhost:3001/mcp                                      ││
│   │                                                                            ││
│   │     - name: postgres                                                      ││
│   │       transport: stdio                                                    ││
│   │       command: npx @modelcontextprotocol/server-postgres                  ││
│   │       env:                                                                ││
│   │         DATABASE_URL: ${DATABASE_URL}                                     ││
│   │                                                                            ││
│   │     - name: filesystem                                                    ││
│   │       transport: stdio                                                    ││
│   │       command: npx @modelcontextprotocol/server-filesystem                ││
│   │       args: ["/path/to/allowed/directory"]                                ││
│   │                                                                            ││
│   └───────────────────────────────────────────────────────────────────────────┘│
│                                                                                  │
│   Available Tools (from MCP servers):                                           │
│   ┌───────────────────────────────────────────────────────────────────────────┐│
│   │                                                                            ││
│   │   github.search_code(query, repo)                                         ││
│   │   github.get_file_contents(path, repo)                                    ││
│   │   github.create_issue(title, body, repo)                                  ││
│   │   slack.search_messages(query, channel)                                   ││
│   │   slack.post_message(channel, text)                                       ││
│   │   jira.get_issue(key)                                                     ││
│   │   jira.search_issues(jql)                                                 ││
│   │   postgres.query(sql)                                                     ││
│   │   filesystem.read_file(path)                                              ││
│   │                                                                            ││
│   └───────────────────────────────────────────────────────────────────────────┘│
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### 4. Context Source Priority

When gathering context, sources are queried in priority order:

| Priority | Source | Use Case | Latency |
|----------|--------|----------|---------|
| 1 | Vector DB | Semantic code search | ~50ms |
| 2 | RAG (local) | Docs, issues, PRs | ~100ms |
| 3 | MCP Servers | Live external data | ~200ms |
| 4 | Web Search | Public documentation | ~500ms |
| 5 | Live APIs | Real-time data | ~300ms |

---

### Researcher (Pool)

The Researcher pool gathers external information needed for implementation:
- **Documentation lookup** - find relevant docs for libraries, APIs, frameworks
- **API exploration** - discover endpoints, schemas, authentication methods
- **Best practices** - research current patterns, conventions, solutions
- **Error investigation** - search for known issues, fixes, workarounds
- **Dependency analysis** - evaluate libraries, compare alternatives
- **Security advisories** - check for CVEs, vulnerabilities
- **Migration guides** - find upgrade paths, breaking changes

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         RESEARCHER POOL (Shared)                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   ┌─────────────────────────────────────────────────────────────────────────┐  │
│   │                                                                          │  │
│   │   ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐           │  │
│   │   │ Researcher│  │ Researcher│  │ Researcher│  │ Researcher│           │  │
│   │   │    R1     │  │    R2     │  │    R3     │  │    R4     │           │  │
│   │   │           │  │           │  │           │  │           │           │  │
│   │   │  (busy)   │  │  (idle)   │  │  (busy)   │  │  (idle)   │           │  │
│   │   │ Issue #42 │  │     -     │  │ Issue #15 │  │     -     │           │  │
│   │   └───────────┘  └───────────┘  └───────────┘  └───────────┘           │  │
│   │                                                                          │  │
│   │   Capabilities:                                                         │  │
│   │   ├── Web search (Google, Bing, DuckDuckGo)                             │  │
│   │   ├── Documentation fetch (MDN, npm, PyPI, crates.io)                   │  │
│   │   ├── GitHub search (code, issues, discussions)                         │  │
│   │   ├── Stack Overflow search                                             │  │
│   │   ├── API documentation parsing                                         │  │
│   │   └── Security database queries (NVD, Snyk)                             │  │
│   │                                                                          │  │
│   │   Output:                                                               │  │
│   │   ├── research_summary: string                                          │  │
│   │   ├── sources: { url, title, relevance }[]                              │  │
│   │   ├── code_examples: { language, code, source }[]                       │  │
│   │   ├── recommendations: string[]                                         │  │
│   │   └── warnings: string[]                                                │  │
│   │                                                                          │  │
│   └─────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
│   Integration in Pipeline:                                                      │
│   ┌───────────────────────────────────────────────────────────────────────────┐│
│   │                                                                            ││
│   │   ANALYZING ──► Need external info? ──► RESEARCHER ──► Enhanced context  ││
│   │                        │                                                   ││
│   │                        └── No ──► Continue with local context             ││
│   │                                                                            ││
│   │   PLANNING ──► Unknown library? ──► RESEARCHER ──► API docs, examples    ││
│   │                                                                            ││
│   │   IMPLEMENTING ──► Error/stuck? ──► RESEARCHER ──► Solutions, fixes      ││
│   │                                                                            ││
│   └───────────────────────────────────────────────────────────────────────────┘│
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

### Agent Permissions System

> **See:** [Story 6-8: Agent Permissions](../stories/epic-6/story-6-8/6-8-agent-permissions.md)

Each agent type has defined permissions (global defaults + per-project overrides):

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         AGENT PERMISSIONS                                        │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   Agent Type      Tools                 Files              Git          Budget  │
│   ─────────────────────────────────────────────────────────────────────────────│
│   SCRUM_MASTER    Read,Glob,Grep,Web    Read: **/*         None         $1/task │
│                   NO: Bash,Write,Edit   Write: None                             │
│                                                                                  │
│   ARCHITECT       Read,Glob,Grep,Web    Read: **/*         None         $2/task │
│                   Approval: Write,Edit  Write: docs/**                          │
│                                                                                  │
│   RESEARCHER      Read,Glob,Grep,Web    Read: **/*         None         $0.5    │
│                   NO: Write,Edit,Bash   Write: None                             │
│                                                                                  │
│   IMPLEMENTER     ALL                   Read: **/*         Commit,Push  $10     │
│                                         Write: src/**      Branch               │
│                                         NO: .env, secrets                       │
│                                                                                  │
│   REVIEWER        Read,Glob,Grep        Read: **/*         Comment      $1      │
│                   NO: Write,Edit,Bash   Write: None                             │
│                                                                                  │
│   TESTER          Read,Write,Edit,Bash  Read: **/*         Commit,Push  $5      │
│                                         Write: tests/**                         │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘

Permission Hierarchy:
┌─────────────────┐
│ GLOBAL DEFAULTS │  ◄── Apply to all projects
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ PROJECT OVERRIDE│  ◄── Can be stricter or more permissive
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ EFFECTIVE       │  ◄── Resolved permissions for agent in project
│ PERMISSIONS     │
└─────────────────┘
```

---

### LLM Cost Monitoring

> **See:** [Story 6-7: LLM Cost Monitoring](../stories/epic-6/story-6-7/6-7-llm-cost-monitoring.md)

Track and control LLM spending across all providers and projects:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         COST MONITORING                                          │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   USAGE TRACKING                                                                │
│   ┌─────────────────────────────────────────────────────────────────────────┐  │
│   │                                                                          │  │
│   │   Every LLM call records:                                               │  │
│   │   • Provider (Anthropic, OpenAI, OpenRouter, Local)                     │  │
│   │   • Model                                                               │  │
│   │   • Input/Output tokens                                                 │  │
│   │   • Cost (USD)                                                          │  │
│   │   • Project ID                                                          │  │
│   │   • Agent type                                                          │  │
│   │   • Task ID                                                             │  │
│   │                                                                          │  │
│   └─────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
│   LIMITS                                                                        │
│   ┌─────────────────────────────────────────────────────────────────────────┐  │
│   │                                                                          │  │
│   │   Scope              Period    Limit     Action                         │  │
│   │   ────────────────────────────────────────────────────                 │  │
│   │   Global             Monthly   $500      Throttle                       │  │
│   │   Per Project        Daily     $50       Block                          │  │
│   │   Per Provider       Monthly   $200      Warn                           │  │
│   │   Per Agent Type     Daily     $20       Warn                           │  │
│   │                                                                          │  │
│   │   Thresholds: 70% (info) → 90% (warn) → 100% (action)                   │  │
│   │                                                                          │  │
│   └─────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
│   ALERTS                                                                        │
│   ┌─────────────────────────────────────────────────────────────────────────┐  │
│   │                                                                          │  │
│   │   • Approaching limit (70%, 90%)                                        │  │
│   │   • Limit exceeded                                                      │  │
│   │   • Unusual spending spike                                              │  │
│   │   • Rate limit errors                                                   │  │
│   │                                                                          │  │
│   │   Channels: CLI, Webhook, Email, Slack                                  │  │
│   │                                                                          │  │
│   └─────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

### Agent Knowledge Base

> **See:** [Story 6-9: Agent Knowledge Base](../stories/epic-6/story-6-9/6-9-agent-knowledge-base.md)

Shared knowledge for all agents:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         AGENT KNOWLEDGE BASE                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐             │
│   │ RECOMMENDATIONS │   │  PROHIBITIONS   │   │   LEARNINGS     │             │
│   │                 │   │                 │   │                 │             │
│   │ • Best          │   │ • Never commit  │   │ • From past     │             │
│   │   practices     │   │   .env files    │   │   successes     │             │
│   │ • Coding        │   │ • Don't modify  │   │ • From past     │             │
│   │   standards     │   │   legacy auth   │   │   failures      │             │
│   │ • Preferred     │   │ • No rm -rf /   │   │ • What worked   │             │
│   │   patterns      │   │ • Don't skip    │   │ • What didn't   │             │
│   │                 │   │   tests         │   │                 │             │
│   │ Priority: Med   │   │ Priority: Crit  │   │ Priority: Var   │             │
│   └─────────────────┘   └─────────────────┘   └─────────────────┘             │
│                                                                                  │
│   SCOPES:                                                                       │
│   • Global (all projects)                                                       │
│   • Per-project                                                                 │
│   • Per-agent-type                                                              │
│                                                                                  │
│   SOURCES:                                                                      │
│   • Manual curation                                                             │
│   • Auto-captured from task success/failure                                     │
│   • Code review feedback                                                        │
│   • External imports                                                            │
│                                                                                  │
│   PRE-TASK CHECK:                                                               │
│   1. Agent queries KB with task context                                         │
│   2. Scrum Master validates plan against KB                                     │
│   3. Critical prohibitions → BLOCK                                              │
│   4. Warnings → Proceed with caution                                            │
│   5. Recommendations → Enhance plan                                             │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

### Architect (Pool)

The Architect pool provides shared expertise across projects for:
- **System design** - high-level architecture decisions
- **Code standards** - enforce patterns, conventions, best practices
- **Technical review** - validate plans meet architectural requirements
- **Dependency decisions** - approve new libraries, frameworks
- **Breaking changes** - review and approve API/schema changes
- **Performance** - identify bottlenecks, suggest optimizations
- **Security** - review for vulnerabilities, enforce security patterns

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         ARCHITECT POOL (Shared)                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   ┌─────────────────────────────────────────────────────────────────────────┐  │
│   │                                                                          │  │
│   │   ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐           │  │
│   │   │ Architect │  │ Architect │  │ Architect │  │ Architect │           │  │
│   │   │    A1     │  │    A2     │  │    A3     │  │    A4     │           │  │
│   │   │           │  │           │  │           │  │           │           │  │
│   │   │  (busy)   │  │  (busy)   │  │  (idle)   │  │  (idle)   │           │  │
│   │   │ Project A │  │ Project C │  │     -     │  │     -     │           │  │
│   │   └───────────┘  └───────────┘  └───────────┘  └───────────┘           │  │
│   │                                                                          │  │
│   │   Consulted For:                                                        │  │
│   │   ├── Plan review (complexity: high)                                    │  │
│   │   ├── New file/module creation                                          │  │
│   │   ├── API changes                                                       │  │
│   │   ├── Database schema changes                                           │  │
│   │   ├── New dependency introduction                                       │  │
│   │   ├── Cross-cutting concerns (auth, logging, etc.)                      │  │
│   │   └── Performance-critical code                                         │  │
│   │                                                                          │  │
│   └─────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Per-Project Agent Assignment

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         PROJECT-LEVEL AGENT INSTANCES                            │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  PROJECT A (owner/repo-a)                                                       │
│  ┌───────────────────────────────────────────────────────────────────────────┐ │
│  │                                                                            │ │
│  │   ┌────────────────────────────────────────────────────────────────────┐ │ │
│  │   │  SCRUM MASTER (dedicated to Project A)                              │ │ │
│  │   │  • Prioritizes backlog                                              │ │ │
│  │   │  • Coordinates engines                                              │ │ │
│  │   │  • Handles user queries                                             │ │ │
│  │   └─────────────────────────────┬──────────────────────────────────────┘ │ │
│  │                                 │                                         │ │
│  │              ┌──────────────────┼──────────────────┐                     │ │
│  │              ▼                  ▼                  ▼                     │ │
│  │   ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐           │ │
│  │   │ Engine A1       │ │ Engine A2       │ │ Engine A3       │           │ │
│  │   │                 │ │                 │ │                 │           │ │
│  │   │ Issue #42       │ │ Issue #43       │ │ Issue #44       │           │ │
│  │   │                 │ │                 │ │                 │           │ │
│  │   │ Agents (pool):  │ │ Agents (pool):  │ │ Agents (pool):  │           │ │
│  │   │ • AN1 (analyst) │ │ • AN2 (analyst) │ │ • AN3 (analyst) │           │ │
│  │   │ • RS1 (research)│ │ • PL1 (planner) │ │ • AR1 (archit.) │           │ │
│  │   │ • PL2 (planner) │ │ • IM3 (implmtr) │ │ • PL3 (planner) │           │ │
│  │   │ • IM1 (implmtr) │ │ • RV1 (reviewer)│ │ • IM2 (implmtr) │           │ │
│  │   │ • RV3 (reviewer)│ │                 │ │ • TS1 (tester)  │           │ │
│  │   └─────────────────┘ └─────────────────┘ └─────────────────┘           │ │
│  │                                                                            │ │
│  └───────────────────────────────────────────────────────────────────────────┘ │
│                                                                                  │
│  PROJECT B (owner/repo-b)                                                       │
│  ┌───────────────────────────────────────────────────────────────────────────┐ │
│  │                                                                            │ │
│  │   ┌────────────────────────────────────────────────────────────────────┐ │ │
│  │   │  SCRUM MASTER (dedicated to Project B)                              │ │ │
│  │   └─────────────────────────────┬──────────────────────────────────────┘ │ │
│  │                                 │                                         │ │
│  │                                 ▼                                         │ │
│  │   ┌─────────────────┐                                                    │ │
│  │   │ Engine B1       │                                                    │ │
│  │   │                 │                                                    │ │
│  │   │ Issue #15       │                                                    │ │
│  │   │                 │                                                    │ │
│  │   │ Agents (pool):  │  ◄── Agents acquired from SAME shared pools       │ │
│  │   │ • AN4 (analyst) │      as Project A, released when done             │ │
│  │   │ • RS2 (research)│                                                    │ │
│  │   │ • PL4 (planner) │                                                    │ │
│  │   │ • IM4 (implmtr) │                                                    │ │
│  │   │ • RV2 (reviewer)│                                                    │ │
│  │   └─────────────────┘                                                    │ │
│  │                                                                            │ │
│  └───────────────────────────────────────────────────────────────────────────┘ │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Agent Pool Management

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         AGENT POOL MANAGER                                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   ┌─────────────────────────────────────────────────────────────────────────┐  │
│   │                        POOL CONFIGURATION                                │  │
│   │                                                                          │  │
│   │   Role: IMPLEMENTER                                                     │  │
│   │   ┌───────────────────────────────────────────────────────────────────┐│  │
│   │   │                                                                    ││  │
│   │   │   Primary Provider: Claude Code                                   ││  │
│   │   │   Fallback Provider: OpenCode                                     ││  │
│   │   │                                                                    ││  │
│   │   │   Pool Settings:                                                  ││  │
│   │   │   ├── min_instances: 2                                            ││  │
│   │   │   ├── max_instances: 10                                           ││  │
│   │   │   ├── scale_up_threshold: 80% utilization                         ││  │
│   │   │   ├── scale_down_threshold: 20% utilization                       ││  │
│   │   │   └── idle_timeout: 5 minutes                                     ││  │
│   │   │                                                                    ││  │
│   │   │   Instance Status:                                                ││  │
│   │   │   ┌────────┬──────────┬───────────┬────────────────┐             ││  │
│   │   │   │ Agent  │ Status   │ Project   │ Current Task   │             ││  │
│   │   │   ├────────┼──────────┼───────────┼────────────────┤             ││  │
│   │   │   │ I1     │ busy     │ repo-a    │ Issue #42      │             ││  │
│   │   │   │ I2     │ busy     │ repo-b    │ Issue #15      │             ││  │
│   │   │   │ I3     │ busy     │ repo-a    │ Issue #43      │             ││  │
│   │   │   │ I4     │ idle     │ -         │ -              │             ││  │
│   │   │   │ I5     │ starting │ repo-c    │ Issue #7       │             ││  │
│   │   │   └────────┴──────────┴───────────┴────────────────┘             ││  │
│   │   │                                                                    ││  │
│   │   └───────────────────────────────────────────────────────────────────┘│  │
│   │                                                                          │  │
│   └─────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
│   ┌─────────────────────────────────────────────────────────────────────────┐  │
│   │                        AGENT ACQUISITION FLOW                            │  │
│   │                                                                          │  │
│   │   Engine needs Implementer                                              │  │
│   │         │                                                                │  │
│   │         ▼                                                                │  │
│   │   ┌──────────────┐                                                      │  │
│   │   │ Check Pool   │                                                      │  │
│   │   └──────┬───────┘                                                      │  │
│   │          │                                                               │  │
│   │          ├── idle agent available ──► Acquire & assign to engine        │  │
│   │          │                                                               │  │
│   │          ├── all busy, under max ──► Spawn new agent instance           │  │
│   │          │                                                               │  │
│   │          ├── at max capacity ──► Queue request, wait for release        │  │
│   │          │                                                               │  │
│   │          └── primary unavailable ──► Try fallback provider              │  │
│   │                                                                          │  │
│   └─────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Engine Flow - 8-Step Pipeline with State Machine

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          ENGINE INSTANCE (Per Project)                           │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                         STATE MACHINE (Core)                             │   │
│  │                                                                          │   │
│  │   ┌──────┐                                                              │   │
│  │   │ IDLE │◄────────────────────────────────────────────────────────┐   │   │
│  │   └──┬───┘                                                          │   │   │
│  │      │ poll interval (5 min)                                        │   │   │
│  │      ▼                                                              │   │   │
│  │   ┌──────────────────┐    no issues    ┌──────┐                    │   │   │
│  │   │ SELECTING_ISSUE  │ ──────────────► │ IDLE │                    │   │   │
│  │   │                  │                 └──────┘                    │   │   │
│  │   │ 1. Query GitHub  │                                             │   │   │
│  │   │ 2. Filter labels │                                             │   │   │
│  │   │ 3. Oldest first  │                                             │   │   │
│  │   │ 4. Assign to bot │                                             │   │   │
│  │   └────────┬─────────┘                                             │   │   │
│  │            │ issue found                                           │   │   │
│  │            ▼                                                       │   │   │
│  │   ┌──────────────────┐                                             │   │   │
│  │   │    ANALYZING     │  ◄── ANALYST Agent                         │   │   │
│  │   │                  │                                             │   │   │
│  │   │ 1. Fetch issue   │                                             │   │   │
│  │   │ 2. Get comments  │                                             │   │   │
│  │   │ 3. Related #refs │                                             │   │   │
│  │   │ 4. Recent commits│                                             │   │   │
│  │   │ 5. Build context │                                             │   │   │
│  │   └────────┬─────────┘                                             │   │   │
│  │            ▼                                                       │   │   │
│  │   ┌──────────────────┐                                             │   │   │
│  │   │    PLANNING      │  ◄── PLANNER Agent                         │   │   │
│  │   │                  │                ┌───────┐                    │   │   │
│  │   │ 1. Call LLM/Agent│                │ ERROR │◄─── on failure     │   │   │
│  │   │ 2. Structured    │                └───────┘                    │   │   │
│  │   │    output schema │                    ▲                        │   │   │
│  │   │ 3. Get plan JSON │                    │                        │   │   │
│  │   └────────┬─────────┘                    │                        │   │   │
│  │            ▼                              │                        │   │   │
│  │   ┌──────────────────┐    rejected        │                        │   │   │
│  │   │AWAITING_APPROVAL │ ───────────────────┘                        │   │   │
│  │   │                  │                                             │   │   │
│  │   │ CLI: y/n prompt  │                                             │   │   │
│  │   │ Auto: skip       │                                             │   │   │
│  │   └────────┬─────────┘                                             │   │   │
│  │            │ approved                                              │   │   │
│  │            ▼                                                       │   │   │
│  │   ┌──────────────────┐                                             │   │   │
│  │   │  IMPLEMENTING    │  ◄── IMPLEMENTER Agent                     │   │   │
│  │   │                  │                                             │   │   │
│  │   │ 1. Create branch │                                             │   │   │
│  │   │ 2. Agent codes   │                                             │   │   │
│  │   │ 3. Run tests     │                                             │   │   │
│  │   │ 4. Commit & push │                                             │   │   │
│  │   └────────┬─────────┘                                             │   │   │
│  │            ▼                                                       │   │   │
│  │   ┌──────────────────┐                                             │   │   │
│  │   │   CREATING_PR    │                                             │   │   │
│  │   │                  │                                             │   │   │
│  │   │ 1. Generate desc │                                             │   │   │
│  │   │ 2. Create PR     │                                             │   │   │
│  │   │ 3. Add labels    │                                             │   │   │
│  │   │ 4. Link issue    │                                             │   │   │
│  │   └────────┬─────────┘                                             │   │   │
│  │            ▼                                                       │   │   │
│  │   ┌──────────────────┐    CI fails     ┌───────┐                   │   │   │
│  │   │   MONITORING     │ ──────────────► │ ERROR │                   │   │   │
│  │   │                  │   or timeout    └───────┘                   │   │   │
│  │   │ Poll CI every 30s│                                             │   │   │
│  │   └────────┬─────────┘                                             │   │   │
│  │            │ CI passes                                             │   │   │
│  │            ▼                                                       │   │   │
│  │   ┌──────────────────┐                                             │   │   │
│  │   │    MERGING       │                                             │   │   │
│  │   │                  │                                             │   │   │
│  │   │ 1. Merge PR      │                                             │   │   │
│  │   │ 2. Delete branch │                                             │   │   │
│  │   │ 3. Close issue   │                                             │   │   │
│  │   │ 4. Post comment  │                                             │   │   │
│  │   └────────┬─────────┘                                             │   │   │
│  │            │                                                       │   │   │
│  │            └───────────────────────────────────────────────────────┘   │   │
│  │                                                                          │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Manager Architecture - Detailed View

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              TAMMA MANAGER                                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                         USER INTERFACE LAYER                             │   │
│  │                                                                          │   │
│  │   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                 │   │
│  │   │   CLI       │    │   Web UI    │    │   API       │                 │   │
│  │   │   Commands  │    │  Dashboard  │    │  Endpoints  │                 │   │
│  │   └──────┬──────┘    └──────┬──────┘    └──────┬──────┘                 │   │
│  │          │                  │                  │                        │   │
│  │          └──────────────────┴─────────┬───────┴                        │   │
│  │                                       │                                 │   │
│  │                                       ▼                                 │   │
│  │                        ┌──────────────────────────┐                    │   │
│  │                        │   LLM CONVERSATION       │                    │   │
│  │                        │   INTERFACE              │                    │   │
│  │                        │                          │                    │   │
│  │                        │ • "What's the status     │                    │   │
│  │                        │    of project X?"        │                    │   │
│  │                        │ • "Pause all engines"    │                    │   │
│  │                        │ • "Why did issue #42     │                    │   │
│  │                        │    fail?"                │                    │   │
│  │                        │ • "Show me today's PRs"  │                    │   │
│  │                        └────────────┬─────────────┘                    │   │
│  │                                     │                                  │   │
│  └─────────────────────────────────────┼──────────────────────────────────┘   │
│                                        │                                       │
│  ┌─────────────────────────────────────┼──────────────────────────────────┐   │
│  │                         MANAGER CORE                                    │   │
│  │                                     ▼                                   │   │
│  │   ┌────────────────────────────────────────────────────────────────┐  │   │
│  │   │                    PROJECT REGISTRY                             │  │   │
│  │   │                                                                 │  │   │
│  │   │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │  │   │
│  │   │  │ Project A   │  │ Project B   │  │ Project C   │            │  │   │
│  │   │  │             │  │             │  │             │            │  │   │
│  │   │  │ owner/repo  │  │ owner/repo  │  │ owner/repo  │            │  │   │
│  │   │  │ config      │  │ config      │  │ config      │            │  │   │
│  │   │  │ engine_ids[]│  │ engine_ids[]│  │ engine_ids[]│            │  │   │
│  │   │  │ status      │  │ status      │  │ status      │            │  │   │
│  │   │  └─────────────┘  └─────────────┘  └─────────────┘            │  │   │
│  │   └────────────────────────────────────────────────────────────────┘  │   │
│  │                                                                        │   │
│  │   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐   │   │
│  │   │  ENGINE SPAWNER  │  │  HEALTH MONITOR  │  │  EVENT COLLECTOR │   │   │
│  │   │                  │  │                  │  │                  │   │   │
│  │   │ • Start engine   │  │ • Poll status    │  │ • Aggregate logs │   │   │
│  │   │ • Stop engine    │  │ • Track metrics  │  │ • Store events   │   │   │
│  │   │ • Restart on fail│  │ • Detect anomaly │  │ • Query history  │   │   │
│  │   └──────────────────┘  └──────────────────┘  └──────────────────┘   │   │
│  │                                                                        │   │
│  │   ┌──────────────────────────────────────────────────────────────────┐│   │
│  │   │                     AGENT POOL MANAGER                            ││   │
│  │   │                                                                   ││   │
│  │   │  Manages pools for: ANALYST, PLANNER, IMPLEMENTER, REVIEWER,     ││   │
│  │   │                     TESTER, DOCUMENTER                           ││   │
│  │   │                                                                   ││   │
│  │   │  • Acquire agent for role                                        ││   │
│  │   │  • Release agent back to pool                                    ││   │
│  │   │  • Scale pools based on demand                                   ││   │
│  │   │  • Handle provider failover                                      ││   │
│  │   └──────────────────────────────────────────────────────────────────┘│   │
│  │                                                                        │   │
│  └────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────┐    │
│  │                         ALERT MANAGER                                   │    │
│  │                                                                         │    │
│  │   Triggers:                          Channels:                         │    │
│  │   • Engine error (3 retries)         • CLI notification               │    │
│  │   • System error                     • Webhook (HMAC signed)          │    │
│  │   • API rate limit                   • Email                          │    │
│  │   • CI timeout                       • Slack                          │    │
│  │   • Budget exceeded                  • PagerDuty                      │    │
│  │                                                                         │    │
│  │   Rate Limit: 5 alerts/min           Cooldown: 15 min per alert type  │    │
│  │   Acknowledgment workflow            Escalation on no-ack             │    │
│  └────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Multi-Step Development Process - Detailed Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    MULTI-STEP DEVELOPMENT PROCESS                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  STEP 1: ISSUE SELECTION                                                        │
│  ┌───────────────────────────────────────────────────────────────────────────┐ │
│  │  GitHub API                                                                │ │
│  │      │                                                                     │ │
│  │      ▼                                                                     │ │
│  │  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐               │ │
│  │  │ Issue 1 │    │ Issue 2 │    │ Issue 3 │    │ Issue 4 │               │ │
│  │  │ tamma   │    │ tamma   │    │ wontfix │    │ tamma   │               │ │
│  │  │ 2 days  │    │ 1 day   │    │ 3 days  │    │ 4 hours │               │ │
│  │  └────┬────┘    └─────────┘    └────X────┘    └─────────┘               │ │
│  │       │              ▲              │              ▲                     │ │
│  │       │              │         excluded           │                      │ │
│  │       ▼              │                            │                      │ │
│  │  SELECTED ────── oldest first, has 'tamma' label ─┘                     │ │
│  │  (assigned to bot, comment posted)                                       │ │
│  └───────────────────────────────────────────────────────────────────────────┘ │
│                                                                                  │
│  STEP 2: CONTEXT ANALYSIS (ANALYST Agent)                                       │
│  ┌───────────────────────────────────────────────────────────────────────────┐ │
│  │                                                                            │ │
│  │  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐                  │ │
│  │  │ Issue Body   │   │ Comments     │   │ Related      │                  │ │
│  │  │              │ + │ (all)        │ + │ Issues #N    │                  │ │
│  │  └──────────────┘   └──────────────┘   └──────────────┘                  │ │
│  │          │                  │                  │                          │ │
│  │          └──────────────────┴─────────┬───────┴                          │ │
│  │                                       │                                   │ │
│  │                                       ▼                                   │ │
│  │                        ┌──────────────────────────┐                      │ │
│  │                        │    CONTEXT DOCUMENT      │                      │ │
│  │                        │    (500-1000 words)      │                      │ │
│  │                        │                          │                      │ │
│  │                        │ + Recent 10 commits      │                      │ │
│  │                        │ + Repository structure   │                      │ │
│  │                        └──────────────────────────┘                      │ │
│  └───────────────────────────────────────────────────────────────────────────┘ │
│                                                                                  │
│  STEP 3: PLAN GENERATION (PLANNER Agent)                                        │
│  ┌───────────────────────────────────────────────────────────────────────────┐ │
│  │                                                                            │ │
│  │   Context ─────► ┌──────────────────┐ ─────► ┌────────────────────────┐  │ │
│  │                  │  LLM / Agent     │        │  DEVELOPMENT PLAN      │  │ │
│  │                  │                  │        │                        │  │ │
│  │                  │  Structured      │        │  • summary             │  │ │
│  │                  │  Output Schema   │        │  • approach            │  │ │
│  │                  │                  │        │  • fileChanges[]       │  │ │
│  │                  │  JSON response   │        │  • testingStrategy     │  │ │
│  │                  └──────────────────┘        │  • complexity          │  │ │
│  │                                              │  • risks[]             │  │ │
│  │                                              │  • ambiguities[]       │  │ │
│  │                                              └────────────────────────┘  │ │
│  └───────────────────────────────────────────────────────────────────────────┘ │
│                                                                                  │
│  STEP 4: APPROVAL GATE                                                          │
│  ┌───────────────────────────────────────────────────────────────────────────┐ │
│  │                                                                            │ │
│  │   CLI Mode:                           Auto Mode:                          │ │
│  │   ┌────────────────────────────┐      ┌────────────────────────────┐     │ │
│  │   │  Plan displayed to user    │      │  Automatically approved    │     │ │
│  │   │                            │      │  (for CI/unattended)       │     │ │
│  │   │  > Approve? (y/n): y       │      │                            │     │ │
│  │   │                            │      │  ──────────────────────►   │     │ │
│  │   │  ✓ Approved / ✗ Rejected   │      │                            │     │ │
│  │   └────────────────────────────┘      └────────────────────────────┘     │ │
│  │                                                                            │ │
│  │   Future: LLM-powered review, webhook approval, GitHub PR review          │ │
│  └───────────────────────────────────────────────────────────────────────────┘ │
│                                                                                  │
│  STEP 5: BRANCH CREATION                                                        │
│  ┌───────────────────────────────────────────────────────────────────────────┐ │
│  │                                                                            │ │
│  │   main ─────┬───────────────────────────────────────────────              │ │
│  │             │                                                              │ │
│  │             └──► feature/42-add-user-authentication                       │ │
│  │                                                                            │ │
│  │   Naming: feature/{issue-number}-{slugified-title}                        │ │
│  │   Conflict: append -2, -3, etc. (up to 5 attempts)                        │ │
│  │   Validation: verify branch exists via API                                │ │
│  └───────────────────────────────────────────────────────────────────────────┘ │
│                                                                                  │
│  STEP 6: CODE IMPLEMENTATION (IMPLEMENTER Agent)                                │
│  ┌───────────────────────────────────────────────────────────────────────────┐ │
│  │                                                                            │ │
│  │   ┌────────────────────────────────────────────────────────────────────┐ │ │
│  │   │                    CLI AGENT PROVIDER                               │ │ │
│  │   │                    (Claude Code / OpenCode / etc.)                  │ │ │
│  │   │                                                                     │ │ │
│  │   │   Input:                        Output:                            │ │ │
│  │   │   • Plan                        • Files modified                   │ │ │
│  │   │   • Working directory           • Tests written                    │ │ │
│  │   │   • Model                       • Commits made                     │ │ │
│  │   │   • Budget limit                • Cost tracked                     │ │ │
│  │   │   • Allowed tools               • Progress events                  │ │ │
│  │   │                                                                     │ │ │
│  │   │   Agent Actions:                                                   │ │ │
│  │   │   ├── Read existing code                                           │ │ │
│  │   │   ├── Write/Edit files                                             │ │ │
│  │   │   ├── Run TypeScript compiler                                      │ │ │
│  │   │   ├── Run test suite                                               │ │ │
│  │   │   ├── Fix failing tests                                            │ │ │
│  │   │   ├── Git commit                                                   │ │ │
│  │   │   └── Git push                                                     │ │ │
│  │   └────────────────────────────────────────────────────────────────────┘ │ │
│  │                                                                            │ │
│  │   Retry Logic: 3 attempts with exponential backoff + jitter               │ │
│  │   Transient: network, rate limit, 503/529                                 │ │
│  └───────────────────────────────────────────────────────────────────────────┘ │
│                                                                                  │
│  STEP 7: PR CREATION                                                            │
│  ┌───────────────────────────────────────────────────────────────────────────┐ │
│  │                                                                            │ │
│  │   ┌────────────────────────────────────────────────────────────────────┐ │ │
│  │   │  PR #123: Add user authentication                                   │ │ │
│  │   │                                                                     │ │ │
│  │   │  ## Summary                                                         │ │ │
│  │   │  Implements JWT-based authentication...                             │ │ │
│  │   │                                                                     │ │ │
│  │   │  ## Changes                                                         │ │ │
│  │   │  - src/auth/jwt.ts (new)                                            │ │ │
│  │   │  - src/middleware/auth.ts (modified)                                │ │ │
│  │   │                                                                     │ │ │
│  │   │  ## Testing                                                         │ │ │
│  │   │  Added unit tests for JWT validation...                             │ │ │
│  │   │                                                                     │ │ │
│  │   │  Closes #42                                                         │ │ │
│  │   │                                                                     │ │ │
│  │   │  Labels: [tamma-automated]                                          │ │ │
│  │   └────────────────────────────────────────────────────────────────────┘ │ │
│  │                                                                            │ │
│  │   + Comment posted on issue: "Created PR #123"                            │ │
│  │   + Validation: verify PR exists via API                                  │ │
│  └───────────────────────────────────────────────────────────────────────────┘ │
│                                                                                  │
│  STEP 8: MONITOR & MERGE                                                        │
│  ┌───────────────────────────────────────────────────────────────────────────┐ │
│  │                                                                            │ │
│  │   ┌──────────────┐     poll 30s     ┌──────────────┐                     │ │
│  │   │   CI Check   │ ◄───────────────►│  GitHub API  │                     │ │
│  │   └──────┬───────┘                  └──────────────┘                     │ │
│  │          │                                                                │ │
│  │          ├── pending ────► continue polling (up to 1 hour)               │ │
│  │          │                                                                │ │
│  │          ├── failure ────► ERROR state, alert, next issue                │ │
│  │          │                                                                │ │
│  │          └── success ────► MERGE                                         │ │
│  │                               │                                           │ │
│  │                               ▼                                           │ │
│  │                    ┌──────────────────────┐                              │ │
│  │                    │  1. Squash merge PR  │                              │ │
│  │                    │  2. Delete branch    │                              │ │
│  │                    │  3. Close issue      │                              │ │
│  │                    │  4. Post comment:    │                              │ │
│  │                    │     "Resolved via    │                              │ │
│  │                    │      PR #123"        │                              │ │
│  │                    └──────────────────────┘                              │ │
│  │                               │                                           │ │
│  │                               ▼                                           │ │
│  │                         BACK TO IDLE                                      │ │
│  │                    (poll for next issue)                                  │ │
│  └───────────────────────────────────────────────────────────────────────────┘ │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Provider Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         PROVIDER ARCHITECTURE                                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│                              TASK ROUTER                                         │
│  ┌───────────────────────────────────────────────────────────────────────────┐ │
│  │                                                                            │ │
│  │   Task Type              Provider Selection                               │ │
│  │   ──────────────────────────────────────────────────────────             │ │
│  │   issue_analysis    ──►  ILLMProvider (OpenRouter/Claude API)            │ │
│  │   plan_generation   ──►  ILLMProvider (Claude API)                       │ │
│  │   code_review       ──►  ILLMProvider (OpenRouter/GPT-4)                 │ │
│  │   implementation    ──►  ICLIAgentProvider (Claude Code / OpenCode)      │ │
│  │   test_generation   ──►  ICLIAgentProvider (Claude Code)                 │ │
│  │   documentation     ──►  ILLMProvider (Gemini Flash)                     │ │
│  │                                                                            │ │
│  └───────────────────────────────────────────────────────────────────────────┘ │
│                                                                                  │
│  ┌───────────────────────────────┐    ┌───────────────────────────────┐       │
│  │      ILLMProvider             │    │    ICLIAgentProvider          │       │
│  │      (Direct API)             │    │    (Subprocess)               │       │
│  │                               │    │                               │       │
│  │  ┌─────────────────────────┐ │    │  ┌─────────────────────────┐ │       │
│  │  │  Anthropic (Claude)     │ │    │  │  Claude Code            │ │       │
│  │  │  • claude-3.5-sonnet    │ │    │  │  claude -p --output-    │ │       │
│  │  │  • claude-3-opus        │ │    │  │    format stream-json   │ │       │
│  │  └─────────────────────────┘ │    │  └─────────────────────────┘ │       │
│  │                               │    │                               │       │
│  │  ┌─────────────────────────┐ │    │  ┌─────────────────────────┐ │       │
│  │  │  OpenRouter (100+)      │ │    │  │  OpenCode               │ │       │
│  │  │  • anthropic/claude     │ │    │  │  opencode -p -f json    │ │       │
│  │  │  • openai/gpt-4o        │ │    │  └─────────────────────────┘ │       │
│  │  │  • google/gemini-pro    │ │    │                               │       │
│  │  │  • meta-llama/llama-3   │ │    │  ┌─────────────────────────┐ │       │
│  │  └─────────────────────────┘ │    │  │  Cline CLI (Preview)    │ │       │
│  │                               │    │  │  cline -y --json        │ │       │
│  │  ┌─────────────────────────┐ │    │  └─────────────────────────┘ │       │
│  │  │  Google Gemini          │ │    │                               │       │
│  │  │  • gemini-1.5-pro       │ │    │  ┌─────────────────────────┐ │       │
│  │  │  • gemini-1.5-flash     │ │    │  │  Goose                  │ │       │
│  │  └─────────────────────────┘ │    │  │  goose run -t "prompt"  │ │       │
│  │                               │    │  └─────────────────────────┘ │       │
│  │  ┌─────────────────────────┐ │    │                               │       │
│  │  │  Local LLMs (Future)    │ │    │  ┌─────────────────────────┐ │       │
│  │  │  • Ollama               │ │    │  │  Gemini CLI             │ │       │
│  │  │  • vLLM                 │ │    │  │  gemini --non-          │ │       │
│  │  │  • LM Studio            │ │    │  │    interactive          │ │       │
│  │  └─────────────────────────┘ │    │  └─────────────────────────┘ │       │
│  │                               │    │                               │       │
│  └───────────────────────────────┘    └───────────────────────────────┘       │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Event Flow & Alerting

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         EVENT FLOW & ALERTING                                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   ENGINE INSTANCE                                                               │
│   ┌─────────────────────────────────────────────────────────────────────────┐  │
│   │                                                                          │  │
│   │   Action                        Event Emitted                           │  │
│   │   ─────────────────────────────────────────────────                    │  │
│   │   setState()              ──►   STATE_TRANSITION                        │  │
│   │   selectIssue()           ──►   ISSUE_SELECTED                          │  │
│   │   analyzeIssue()          ──►   ISSUE_ANALYZED                          │  │
│   │   generatePlan()          ──►   PLAN_GENERATED                          │  │
│   │   awaitApproval()         ──►   PLAN_APPROVED / PLAN_REJECTED           │  │
│   │   createBranch()          ──►   BRANCH_CREATED                          │  │
│   │   implementCode()         ──►   IMPLEMENTATION_STARTED                  │  │
│   │                           ──►   IMPLEMENTATION_COMPLETED / FAILED       │  │
│   │   createPR()              ──►   PR_CREATED                              │  │
│   │   mergePR()               ──►   PR_MERGED                               │  │
│   │   deleteBranch()          ──►   BRANCH_DELETED                          │  │
│   │   closeIssue()            ──►   ISSUE_CLOSED                            │  │
│   │   onError()               ──►   ERROR_OCCURRED                          │  │
│   │                                                                          │  │
│   └─────────────────────────────────────────────┬────────────────────────────┘  │
│                                                 │                               │
│                                                 ▼                               │
│   ┌─────────────────────────────────────────────────────────────────────────┐  │
│   │                           EVENT STORE                                    │  │
│   │                                                                          │  │
│   │   { id, timestamp, type, issueNumber?, data: {...} }                    │  │
│   │                                                                          │  │
│   │   Query Methods:                                                         │  │
│   │   • getEvents()                 - all events                             │  │
│   │   • getEvents(issueNumber)      - events for specific issue             │  │
│   │   • getLastEvent(type)          - most recent of type                   │  │
│   │                                                                          │  │
│   └─────────────────────────────────────────────┬────────────────────────────┘  │
│                                                 │                               │
│                                                 ▼                               │
│   ┌─────────────────────────────────────────────────────────────────────────┐  │
│   │                          MANAGER MONITOR                                 │  │
│   │                                                                          │  │
│   │   ┌──────────────────────────────────────────────────────────────────┐ │  │
│   │   │                     ALERT TRIGGERS                                │ │  │
│   │   │                                                                   │ │  │
│   │   │   • IMPLEMENTATION_FAILED (3x retries)  ──►  ESCALATION ALERT    │ │  │
│   │   │   • ERROR_OCCURRED (system error)       ──►  CRITICAL ALERT      │ │  │
│   │   │   • Rate limit hit                      ──►  WARNING ALERT       │ │  │
│   │   │   • CI timeout (1 hour)                 ──►  WARNING ALERT       │ │  │
│   │   │   • Budget exceeded                     ──►  WARNING ALERT       │ │  │
│   │   │                                                                   │ │  │
│   │   └───────────────────────────────────────────────────────┬──────────┘ │  │
│   │                                                           │            │  │
│   │                                                           ▼            │  │
│   │   ┌──────────────────────────────────────────────────────────────────┐ │  │
│   │   │                     ALERT MANAGER                                 │ │  │
│   │   │                                                                   │ │  │
│   │   │   Rate Limit: 5 alerts/minute                                    │ │  │
│   │   │   Cooldown: 15 min per alert type                                │ │  │
│   │   │   Deduplication: same alert within window                        │ │  │
│   │   │                                                                   │ │  │
│   │   │   ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐   │ │  │
│   │   │   │   CLI     │  │  Webhook  │  │   Email   │  │   Slack   │   │ │  │
│   │   │   │ Terminal  │  │  (HMAC)   │  │           │  │           │   │ │  │
│   │   │   └───────────┘  └───────────┘  └───────────┘  └───────────┘   │ │  │
│   │   │                                                                   │ │  │
│   │   │   Acknowledgment Workflow:                                       │ │  │
│   │   │   Alert ──► Pending ──► Acknowledged ──► Resolved                │ │  │
│   │   │              │                                                    │ │  │
│   │   │              └──► No-ack (30 min) ──► Escalate                   │ │  │
│   │   │                                                                   │ │  │
│   │   └──────────────────────────────────────────────────────────────────┘ │  │
│   │                                                                          │  │
│   └─────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary

### Four-Layer Architecture

| Layer | Purpose | Scaling |
|-------|---------|---------|
| **Manager** | Main interface, project registry, agent pools, alerting | Single instance per Tamma deployment |
| **Scrum Master** | Project coordination, prioritization, user communication | 1 per project |
| **Engine** | Per-issue autonomous worker, state machine, pipeline | Multiple instances per project |
| **Agent Pools** | Specialized AI capabilities by role | Pool of instances per role (shared) |

### Agent Roles

| Role | Scope | Provider Type | Task |
|------|-------|---------------|------|
| SCRUM_MASTER | 1/Project | ILLMProvider | Project coordination, prioritization, user chat |
| ARCHITECT | Pool | ILLMProvider | System design, technical decisions, standards |
| RESEARCHER | Pool | ILLMProvider + Web | Documentation lookup, API exploration, best practices |
| ANALYST | Pool | ILLMProvider | Issue context analysis |
| PLANNER | Pool | ILLMProvider | Development plan generation |
| IMPLEMENTER | Pool | ICLIAgentProvider | Code generation & execution |
| REVIEWER | Pool | ILLMProvider | Code review & quality |
| TESTER | Pool | ICLIAgentProvider | Test generation & execution |
| DOCUMENTER | Pool | ILLMProvider | Documentation generation |

### Concurrency Model

- **Per Tamma**: 1 Manager, N Projects
- **Per Project**: 1 Scrum Master, M Engine instances (parallel issue processing)
- **Per Engine**: Acquires agents from pools as needed
- **Per Pool**: Configurable size (min/max instances), shared across all projects

### Agent Interaction Flow

```
User Question ──► Manager ──► Scrum Master (Project X)
                                    │
                                    ├── Simple query ──► Direct LLM response
                                    │
                                    └── Needs research ──► Acquire RESEARCHER from pool
                                                                │
                                                                └── Return to pool when done

New Issue ──► Scrum Master ──► Prioritize ──► Assign to Engine
                                                    │
                                                    ├── Acquire ANALYST
                                                    ├── Acquire RESEARCHER (if needed)
                                                    ├── Acquire ARCHITECT (if complex)
                                                    ├── Acquire PLANNER
                                                    ├── Acquire IMPLEMENTER
                                                    ├── Acquire REVIEWER
                                                    ├── Acquire TESTER
                                                    └── Release all back to pools
```
