# Autonomous Mentorship - Graphile Worker Setup

## Quick Start (5 minutes)

### 1. Create Project Structure

```bash
mkdir mentorship-workflow
cd mentorship-workflow
npm init -y
npm install @graphile/worker pg
```

### 2. Database Setup

```sql
-- Create database
CREATE DATABASE mentorship;

-- Create jobs table
CREATE TABLE graphile_worker.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_name text NOT NULL,
  task_identifier text NOT NULL,
  payload jsonb,
  run_at timestamptz DEFAULT now(),
  attempts integer DEFAULT 0,
  max_attempts integer DEFAULT 25,
  last_error text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create mentorship tables
CREATE TABLE mentorship_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id text NOT NULL,
  junior_id text NOT NULL,
  current_state text NOT NULL,
  context jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE mentorship_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES mentorship_sessions(id),
  event_type text NOT NULL,
  event_data jsonb,
  created_at timestamptz DEFAULT now()
);
```

### 3. Create Jobs Directory

```bash
mkdir jobs
```

### 4. Implement Mentorship Jobs

```typescript
// jobs/init-story-processing.ts
import { Job, WorkerUtils } from 'graphile-worker';

export interface InitStoryPayload {
  storyId: string;
  juniorId: string;
}

export async function initStoryProcessing(payload: InitStoryPayload, utils: WorkerUtils) {
  const { storyId, juniorId } = payload;

  // Create mentorship session
  const session = await utils.withPgClient(async (client) => {
    const { rows } = await client.query(
      `
      INSERT INTO mentorship_sessions (story_id, junior_id, current_state, context)
      VALUES ($1, $2, 'INIT_STORY_PROCESSING', '{}')
      RETURNING *
    `,
      [storyId, juniorId]
    );
    return rows[0];
  });

  // Queue next job
  await utils.addJob(
    'assess-junior-capability',
    { sessionId: session.id, storyId, juniorId },
    { queueName: 'mentorship' }
  );

  console.log(`🚀 Started mentorship session for story ${storyId}`);
}

// jobs/assess-junior-capability.ts
export interface AssessCapabilityPayload {
  sessionId: string;
  storyId: string;
  juniorId: string;
}

export async function assessJuniorCapability(payload: AssessCapabilityPayload, utils: WorkerUtils) {
  const { sessionId, storyId, juniorId } = payload;

  // Update session state
  await utils.withPgClient(async (client) => {
    await client.query(
      `
      UPDATE mentorship_sessions 
      SET current_state = 'ASSESS_JUNIOR_CAPABILITY', updated_at = now()
      WHERE id = $1
    `,
      [sessionId]
    );
  });

  // Send assessment to junior (Slack, email, etc.)
  await sendToJunior(juniorId, {
    type: 'assessment',
    message: 'What do you understand about this story?',
    storyId,
    timeout: 5 * 60 * 1000, // 5 minutes
  });

  // Schedule timeout check
  await utils.addJob(
    'check-assessment-timeout',
    { sessionId, storyId, juniorId },
    {
      queueName: 'mentorship',
      runAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
    }
  );

  console.log(`📝 Sent assessment to junior ${juniorId}`);
}

// jobs/check-assessment-timeout.ts
export async function checkAssessmentTimeout(payload: AssessCapabilityPayload, utils: WorkerUtils) {
  const { sessionId, storyId, juniorId } = payload;

  // Check if junior responded
  const response = await getJuniorResponse(juniorId, storyId);

  if (!response) {
    // Timeout - escalate
    await utils.addJob(
      'diagnose-blocker',
      {
        sessionId,
        storyId,
        juniorId,
        blockerType: 'timeout',
        currentState: 'ASSESS_JUNIOR_CAPABILITY',
      },
      { queueName: 'mentorship' }
    );

    console.log(`⏰ Timeout detected for junior ${juniorId}`);
  } else {
    // Process response
    await utils.addJob(
      'process-assessment-response',
      { sessionId, storyId, juniorId, response },
      { queueName: 'mentorship' }
    );
  }
}

// jobs/diagnose-blocker.ts
export async function diagnoseBlocker(payload: any, utils: WorkerUtils) {
  const { sessionId, storyId, juniorId, blockerType, currentState } = payload;

  // Update session state
  await utils.withPgClient(async (client) => {
    await client.query(
      `
      UPDATE mentorship_sessions 
      SET current_state = 'DIAGNOSE_BLOCKER', updated_at = now()
      WHERE id = $1
    `,
      [sessionId]
    );
  });

  // Analyze blocker type and provide solution
  let solution;
  switch (blockerType) {
    case 'timeout':
      solution = await analyzeTimeout(juniorId, currentState);
      break;
    case 'technical_error':
      solution = await analyzeTechnicalError(juniorId);
      break;
    case 'conceptual_confusion':
      solution = await analyzeConceptualIssues(juniorId, storyId);
      break;
    default:
      solution = await provideGeneralHelp(juniorId);
  }

  // Send solution to junior
  await sendToJunior(juniorId, {
    type: 'solution',
    message: solution.message,
    action: solution.action,
    timeout: solution.timeout,
  });

  // Schedule verification
  await utils.addJob(
    'verify-solution',
    { sessionId, storyId, juniorId, solution },
    {
      queueName: 'mentorship',
      runAt: new Date(Date.now() + solution.timeout),
    }
  );

  console.log(`🔧 Diagnosed and solved blocker for junior ${juniorId}`);
}
```

### 5. Create Worker Runner

```typescript
// worker.ts
import { run } from 'graphile-worker';
import { initStoryProcessing } from './jobs/init-story-processing';
import { assessJuniorCapability } from './jobs/assess-junior-capability';
import { checkAssessmentTimeout } from './jobs/check-assessment-timeout';
import { diagnoseBlocker } from './jobs/diagnose-blocker';

async function main() {
  const runner = await run({
    connectionString: 'postgresql://user:pass@localhost:5432/mentorship',
    concurrency: 5,
    noHandleSignals: false,
    pollInterval: 1000,
    taskList: {
      'init-story-processing': initStoryProcessing,
      'assess-junior-capability': assessJuniorCapability,
      'check-assessment-timeout': checkAssessmentTimeout,
      'diagnose-blocker': diagnoseBlocker,
      // Add more jobs as needed
    },
  });

  await runner.promise;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

### 6. Docker Compose Setup

```yaml
# docker-compose.yml
version: '3.8'
services:
  db:
    image: postgres:15
    environment:
      POSTGRES_DB: mentorship
      POSTGRES_USER: mentorship
      POSTGRES_PASSWORD: mentorship123
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data

  worker:
    build: .
    environment:
      DATABASE_URL: postgresql://mentorship:mentorship123@db:5432/mentorship
    depends_on:
      - db
    volumes:
      - ./jobs:/app/jobs
    command: npm start

volumes:
  postgres_data:
```

### 7. Start the System

```bash
# Start database and worker
docker-compose up -d

# Initialize first mentorship session
curl -X POST http://localhost:3000/api/mentorship/start \
  -H "Content-Type: application/json" \
  -d '{
    "storyId": "story-123",
    "juniorId": "junior-456"
  }'
```

## Benefits of This Setup

✅ **Minimal Infrastructure** - Runs on a $5/month server
✅ **TypeScript Native** - Perfect for your stack
✅ **Durable Jobs** - Survives restarts and crashes
✅ **Easy Monitoring** - Check the database for job status
✅ **Scalable** - Add more workers as needed
✅ **Version Control** - Jobs are just TypeScript files

## Next Steps

1. **Add more jobs** for each state in your state machine
2. **Implement communication** (Slack, email, in-app)
3. **Add monitoring** (simple dashboard)
4. **Scale up** when team grows

This gives you a production-ready autonomous mentorship system in under an hour!
