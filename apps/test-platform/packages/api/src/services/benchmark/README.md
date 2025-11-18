# Benchmark Infrastructure

Complete system for running AI model benchmarks against programming tasks.

## Architecture

The benchmark infrastructure consists of several key components:

### 1. Model Interface (`model-interface.ts`)
- Abstract interface for different AI providers (Anthropic, OpenAI, Google)
- Handles API communication and response parsing
- Extracts code from various response formats

### 2. Code Analyzer (`code-analyzer.ts`)
- Static code analysis engine
- Analyzes:
  - **Complexity**: Cyclomatic complexity, nesting depth, lines of code
  - **Maintainability**: Function length, code duplication, maintainability index
  - **Documentation**: JSDoc coverage, comment density, examples
  - **Type Usage**: TypeScript type annotations, generics, advanced types
  - **Error Handling**: Try-catch blocks, custom error types, validation
  - **Best Practices**: Naming conventions, SOLID principles, DRY

### 3. Task Executor (`task-executor.ts`)
- Executes a single benchmark task
- Workflow:
  1. Constructs prompt for AI model based on task and role
  2. Generates code using AI model
  3. Runs tests against generated code
  4. Analyzes code quality
  5. Calculates role-based scores
- Creates temporary test environment with Vitest

### 4. Benchmark Runner (`benchmark-runner.ts`)
- Orchestrates complete benchmark runs
- Loads tasks from database
- Executes tasks across multiple models
- Generates comprehensive summaries
- Saves results to JSON files

## Usage

### CLI Usage

Run benchmarks using the command line:

```bash
# Basic usage with default settings
npm run benchmark

# Run specific model with custom parameters
npm run benchmark -- \
  --provider=anthropic \
  --model=claude-3-5-sonnet-20241022 \
  --difficulty=easy \
  --limit=10 \
  --verbose

# Run with config file
npm run benchmark -- --config=./benchmark-config.json

# Compare multiple difficulties
npm run benchmark -- \
  --model=claude-3-5-sonnet-20241022 \
  --difficulty=easy,medium,hard \
  --limit=5

# Save results to custom location
npm run benchmark -- \
  --model=gpt-4 \
  --output=./results/gpt4-benchmark.json \
  --verbose
```

### CLI Options

- `--provider`: AI provider (anthropic, openai, google) [default: anthropic]
- `--model`: Model name [default: claude-3-5-sonnet-20241022]
- `--api-key`: API key (or set ANTHROPIC_API_KEY/OPENAI_API_KEY env var)
- `--temperature`: Sampling temperature [default: 0.7]
- `--max-tokens`: Max output tokens [default: 4096]
- `--language`: Task language filter [default: typescript]
- `--scenario`: Task scenario filter [default: code-generation]
- `--difficulty`: Difficulty level(s) (easy, medium, hard) [comma-separated]
- `--limit`: Max number of tasks to run [default: 10]
- `--timeout`: Task timeout in ms [default: 60000]
- `--verbose`: Show detailed progress
- `--output`: Custom output path for results
- `--config`: Load configuration from JSON file

### Programmatic Usage

```typescript
import { BenchmarkRunner, ModelConfig, BenchmarkRunConfig } from './services/benchmark'

// Configure models to test
const models: ModelConfig[] = [
  {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    apiKey: process.env.ANTHROPIC_API_KEY!,
    temperature: 0.7,
  },
  {
    provider: 'openai',
    model: 'gpt-4-turbo-preview',
    apiKey: process.env.OPENAI_API_KEY!,
    temperature: 0.7,
  },
]

// Configure benchmark run
const config: BenchmarkRunConfig = {
  name: 'TypeScript Code Generation Benchmark',
  description: 'Compare models on Easy difficulty tasks',
  language: 'typescript',
  scenario: 'code-generation',
  difficulty: 'easy',
  limit: 20,
  models,
  parallel: false,
  timeout: 60000,
  saveResults: true,
  outputPath: './results/benchmark-results.json',
  verbose: true,
}

// Run benchmark
const runner = new BenchmarkRunner()
const results = await runner.run(config)

// Access results
console.log(`Average Score: ${results.summary.overall.averageScore}`)
console.log(`Top Model: ${results.summary.overall.modelsRanked[0].model}`)
```

## Configuration File Format

Create a `benchmark-config.json`:

```json
{
  "name": "Multi-Model Comparison",
  "description": "Compare Claude, GPT-4, and Gemini on code generation",
  "language": "typescript",
  "scenario": "code-generation",
  "difficulty": ["easy", "medium"],
  "limit": 50,
  "models": [
    {
      "provider": "anthropic",
      "model": "claude-3-5-sonnet-20241022",
      "apiKey": "${ANTHROPIC_API_KEY}",
      "temperature": 0.7,
      "maxTokens": 4096
    },
    {
      "provider": "openai",
      "model": "gpt-4-turbo-preview",
      "apiKey": "${OPENAI_API_KEY}",
      "temperature": 0.7,
      "maxTokens": 4096
    },
    {
      "provider": "google",
      "model": "gemini-1.5-pro",
      "apiKey": "${GOOGLE_API_KEY}",
      "temperature": 0.7,
      "maxTokens": 4096
    }
  ],
  "parallel": false,
  "maxConcurrency": 3,
  "timeout": 60000,
  "saveResults": true,
  "outputPath": "./results/multi-model-comparison.json",
  "verbose": true
}
```

## Scoring System

### Overall Score Calculation

Each task receives an overall score (0-100) based on weighted criteria specific to the agent's role:

**Developer Role:**
- Correctness (35%): Based on test pass rate
- Code Quality (30%): Static analysis score
- Requirements (20%): All requirements met
- Documentation (15%): JSDoc completeness

**Architect Role:**
- Architecture (35-40%): Design decisions, patterns
- Maintainability (25-30%): Code maintainability index
- Scalability (20%): Scalability considerations
- Documentation (15%): Architectural documentation

**Tester Role:**
- Edge Cases (30-35%): Comprehensive edge case handling
- Coverage (25-35%): Test coverage metrics
- Correctness (20-30%): Test pass rate
- Code Quality (10-15%): Code quality for testability

**UX Designer Role:**
- Clarity (40%): Code readability and clarity
- Documentation (20-30%): Documentation quality
- Correctness (10-30%): Functional correctness
- Examples (10-20%): Usage examples provided

### Code Quality Metrics

Breakdown of code quality analysis:

- **Complexity Score** (0-100):
  - Cyclomatic complexity penalty
  - Nesting depth penalty
  - Lines of code consideration

- **Maintainability Score** (0-100):
  - Maintainability index
  - Function length
  - Code duplication

- **Documentation Score** (0-100):
  - JSDoc coverage (40 points)
  - Examples present (20 points)
  - Type annotations (20 points)
  - Comment density (20 points)

- **Type Usage Score** (0-100):
  - Type annotation coverage (40 points)
  - Generics usage (30 points)
  - Advanced types (20 points)
  - Penalty for 'any' types

- **Error Handling Score** (0-100):
  - Try-catch blocks (40 points)
  - Custom error types (30 points)
  - Error validation (30 points)

- **Best Practices Score** (0-100):
  - Naming conventions (25 points)
  - Single responsibility (25 points)
  - DRY principle (25 points)
  - SOLID principles (25 points)

## Results Format

Benchmark results are saved as JSON with the following structure:

```json
{
  "runId": "abc123",
  "config": { ... },
  "startTime": "2024-11-18T10:00:00.000Z",
  "endTime": "2024-11-18T10:15:00.000Z",
  "duration": 900000,
  "totalTasks": 50,
  "completedTasks": 48,
  "failedTasks": 2,
  "tasks": [
    {
      "taskId": "task-1",
      "modelConfig": { ... },
      "role": "developer",
      "difficulty": "easy",
      "generatedCode": "...",
      "executionTime": 5234,
      "testResults": {
        "passed": 8,
        "failed": 0,
        "total": 8,
        "passRate": 100
      },
      "scores": {
        "overall": 92,
        "correctness": 100,
        "codeQuality": 88,
        "requirements": 90,
        "documentation": 85
      }
    }
  ],
  "summary": {
    "byModel": { ... },
    "byDifficulty": { ... },
    "byRole": { ... },
    "overall": {
      "averageScore": 87.5,
      "averagePassRate": 94.2,
      "modelsRanked": [
        { "model": "claude-3-5-sonnet", "score": 92.3 },
        { "model": "gpt-4", "score": 85.7 }
      ]
    }
  }
}
```

## Example Workflow

1. **Seed the database** with benchmark tasks:
   ```bash
   npm run db:seed
   ```

2. **Run a quick test** with 5 easy tasks:
   ```bash
   npm run benchmark:example
   ```

3. **Run a comprehensive benchmark**:
   ```bash
   npm run benchmark -- \
     --model=claude-3-5-sonnet-20241022 \
     --difficulty=easy,medium,hard \
     --limit=50 \
     --output=./results/full-benchmark.json \
     --verbose
   ```

4. **Analyze results**:
   - Results are saved to JSON file
   - Summary is printed to console
   - Use the JSON data for further analysis/visualization

## Future Enhancements

- [ ] Multi-model parallel execution
- [ ] Real-time progress dashboard
- [ ] Historical comparison (track model improvements over time)
- [ ] Custom evaluation criteria
- [ ] Integration with CI/CD pipelines
- [ ] Public leaderboard
- [ ] Cost tracking (token usage × pricing)
- [ ] Performance profiling (execution time analysis)
- [ ] Test coverage measurement using actual coverage tools
- [ ] Automated retry with exponential backoff
- [ ] Support for streaming responses
- [ ] Docker containerization for isolated test execution
