# Workflow Engine Deployment Guides

## Quick Start Deployment Instructions

### Graphile Worker - 5 Minute Setup

#### Prerequisites

- Node.js 18+
- PostgreSQL database
- Existing project structure

#### Installation

```bash
# Install Graphile Worker
npm install @graphile/worker

# Create worker tasks directory
mkdir -p src/workers
```

#### Basic Configuration

```typescript
// src/workers/index.ts
import { run } from '@graphile/worker';
import { mentorshipTasks } from './mentorship-tasks';

async function main() {
  const runner = await run({
    connectionString: process.env.DATABASE_URL,
    concurrency: 5,
    taskList: mentorshipTasks,
  });

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    await runner.stop();
    process.exit(0);
  });
}

main().catch(console.error);
```

#### Mentorship Task Example

```typescript
// src/workers/mentorship-tasks.ts
import { TaskList } from '@graphile/worker';

export const mentorshipTasks: TaskList = {
  startMentorship: async (payload, helpers) => {
    const { userId, mentorshipId } = payload;

    // Initialize mentorship state
    await helpers.query(
      `UPDATE mentorships SET status = 'active', started_at = NOW() 
       WHERE id = $1`,
      [mentorshipId]
    );

    // Schedule first check-in
    await helpers.addJob(
      'scheduleCheckIn',
      { mentorshipId, userId },
      { runAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } // 24 hours
    );
  },

  scheduleCheckIn: async (payload, helpers) => {
    const { mentorshipId, userId } = payload;

    // Send check-in notification
    await helpers.addJob('sendNotification', {
      userId,
      type: 'check_in',
      mentorshipId,
    });

    // Schedule next check-in
    await helpers.addJob(
      'scheduleCheckIn',
      { mentorshipId, userId },
      { runAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } // 1 week
    );
  },

  sendNotification: async (payload, helpers) => {
    const { userId, type, mentorshipId } = payload;

    // Send notification via your preferred channel
    console.log(`Sending ${type} notification to user ${userId}`);

    // Log notification sent
    await helpers.query(
      `INSERT INTO notifications (user_id, type, mentorship_id, sent_at) 
       VALUES ($1, $2, $3, NOW())`,
      [userId, type, mentorshipId]
    );
  },
};
```

#### Database Setup

```sql
-- Add to your existing migrations
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Graphile Worker schema
CREATE SCHEMA IF NOT EXISTS graphile_worker;

-- Jobs table
CREATE TABLE graphile_worker.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_name text DEFAULT 'default',
  task_identifier text NOT NULL,
  payload json DEFAULT '{}',
  priority integer DEFAULT 0,
  run_at timestamptz DEFAULT now(),
  attempts integer DEFAULT 0,
  max_attempts integer DEFAULT 25,
  last_error text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indexes for performance
CREATE INDEX ON graphile_worker.jobs (queue_name, run_at);
CREATE INDEX ON graphile_worker.jobs (task_identifier);
```

#### Docker Compose

```yaml
# docker-compose.worker.yml
version: '3.8'
services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: tamma
      POSTGRES_USER: tamma
      POSTGRES_PASSWORD: password
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data

  worker:
    build: .
    working_dir: /app
    volumes:
      - .:/app
      - /app/node_modules
    environment:
      DATABASE_URL: postgresql://tamma:password@postgres:5432/tamma
      NODE_ENV: development
    command: npm run worker
    depends_on:
      - postgres
    restart: unless-stopped

volumes:
  postgres_data:
```

#### Package.json Scripts

```json
{
  "scripts": {
    "worker": "tsx src/workers/index.ts",
    "worker:dev": "tsx watch src/workers/index.ts",
    "migrate:worker": "psql $DATABASE_URL -f migrations/worker.sql"
  }
}
```

### n8n - Visual Workflow Setup

#### Docker Compose Deployment

```yaml
# docker-compose.n8n.yml
version: '3.8'
services:
  n8n:
    image: n8nio/n8n:latest
    container_name: n8n
    restart: always
    ports:
      - '5678:5678'
    environment:
      - N8N_BASIC_AUTH_ACTIVE=true
      - N8N_BASIC_AUTH_USER=admin
      - N8N_BASIC_AUTH_PASSWORD=your-secure-password
      - N8N_HOST=localhost
      - N8N_PORT=5678
      - N8N_PROTOCOL=http
      - DB_TYPE=postgresdb
      - DB_POSTGRESDB_HOST=postgres
      - DB_POSTGRESDB_PORT=5432
      - DB_POSTGRESDB_DATABASE=n8n
      - DB_POSTGRESDB_USER=n8n
      - DB_POSTGRESDB_PASSWORD=n8n-password
      - N8N_EMAIL_MODE=smtp
      - N8N_SMTP_HOST=smtp.gmail.com
      - N8N_SMTP_PORT=587
      - N8N_SMTP_USER=your-email@gmail.com
      - N8N_SMTP_PASS=your-app-password
      - N8N_SMTP_SENDER=your-email@gmail.com
    volumes:
      - n8n_data:/home/node/.n8n
    depends_on:
      - postgres

  postgres:
    image: postgres:15
    container_name: n8n-postgres
    restart: always
    environment:
      - POSTGRES_USER=n8n
      - POSTGRES_PASSWORD=n8n-password
      - POSTGRES_DB=n8n
    volumes:
      - n8n_postgres_data:/var/lib/postgresql/data

volumes:
  n8n_data:
  n8n_postgres_data:
```

#### Mentorship Workflow Template

```json
{
  "name": "Autonomous Mentorship Workflow",
  "nodes": [
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "start-mentorship",
        "responseMode": "onReceived",
        "options": {}
      },
      "id": "webhook-1",
      "name": "Start Mentorship Trigger",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 1,
      "position": [240, 300]
    },
    {
      "parameters": {
        "functionCode": "// Initialize mentorship state\nconst { userId, mentorId, goals } = $input.first().json;\n\nreturn {\n  mentorshipId: `mentor_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,\n  userId,\n  mentorId,\n  goals,\n  status: 'active',\n  startedAt: new Date().toISOString(),\n  nextCheckIn: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()\n};"
      },
      "id": "function-1",
      "name": "Initialize Mentorship",
      "type": "n8n-nodes-base.function",
      "typeVersion": 1,
      "position": [460, 300]
    },
    {
      "parameters": {
        "operation": "insert",
        "table": "mentorships",
        "columns": "id, user_id, mentor_id, goals, status, started_at, next_check_in",
        "additionalFields": {}
      },
      "id": "postgres-1",
      "name": "Save to Database",
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 1,
      "position": [680, 300]
    },
    {
      "parameters": {
        "interval": 1000,
        "unit": "hours"
      },
      "id": "cron-1",
      "name": "Daily Check-in Scheduler",
      "type": "n8n-nodes-base.cron",
      "typeVersion": 1,
      "position": [240, 500]
    },
    {
      "parameters": {
        "operation": "select",
        "table": "mentorships",
        "where": {
          "conditions": [
            {
              "column": "status",
              "condition": "equal",
              "value": "active"
            },
            {
              "column": "next_check_in",
              "condition": "smallerEqual",
              "value": "={{ $now }}"
            }
          ]
        }
      },
      "id": "postgres-2",
      "name": "Find Due Check-ins",
      "type": "n8n-nodes-base.postgres",
      "typeVersion": 1,
      "position": [460, 500]
    },
    {
      "parameters": {
        "fromEmail": "mentorship@tamma.dev",
        "toEmail": "={{ $json.user_email }}",
        "subject": "Mentorship Check-in Required",
        "text": "Hi {{ $json.user_name }}, it's time for your mentorship check-in. Please update your progress on your goals: {{ $json.goals }}",
        "options": {}
      },
      "id": "email-1",
      "name": "Send Check-in Email",
      "type": "n8n-nodes-base.emailSend",
      "typeVersion": 1,
      "position": [680, 500]
    }
  ],
  "connections": {
    "Start Mentorship Trigger": {
      "main": [[{ "node": "Initialize Mentorship", "type": "main", "index": 0 }]]
    },
    "Initialize Mentorship": {
      "main": [[{ "node": "Save to Database", "type": "main", "index": 0 }]]
    },
    "Daily Check-in Scheduler": {
      "main": [[{ "node": "Find Due Check-ins", "type": "main", "index": 0 }]]
    },
    "Find Due Check-ins": {
      "main": [[{ "node": "Send Check-in Email", "type": "main", "index": 0 }]]
    }
  }
}
```

### Kestra - Event-Driven Setup

#### Docker Compose Deployment

```yaml
# docker-compose.kestra.yml
version: '3.8'
services:
  kestra:
    image: kestra/kestra:latest
    container_name: kestra
    restart: always
    ports:
      - '8080:8080'
    environment:
      - KESTRA_CONFIGURATION_TYPE=memory
      - KESTRA_QUEUE_TYPE=memory
      - KESTRA_REPOSITORY_TYPE=memory
      - KESTRA_WEB_ENABLE=true
      - KESTRA_WEB_PATH=/ui
    volumes:
      - ./kestra-flows:/app/flows
      - kestra_data:/app/storage

  postgres:
    image: postgres:15
    container_name: kestra-postgres
    restart: always
    environment:
      - POSTGRES_USER=kestra
      - POSTGRES_PASSWORD=kestra
      - POSTGRES_DB=kestra
    volumes:
      - kestra_postgres_data:/var/lib/postgresql/data

volumes:
  kestra_data:
  kestra_postgres_data:
```

#### Mentorship Flow Definition

```yaml
# kestra-flows/mentorship-flow.yml
id: autonomous-mentorship
namespace: tamma.mentorship

tasks:
  - id: start-mentorship
    type: io.kestra.core.tasks.flows.Flow
    triggers:
      - id: webhook-trigger
        type: io.kestra.core.models.triggers.types.Webhook
        key: mentorship-start
    tasks:
      - id: initialize-mentorship
        type: io.kestra.core.tasks.log.Log
        message: 'Starting mentorship for user {{ trigger.body.userId }}'

      - id: save-mentorship-state
        type: io.kestra.plugin.jdbc.postgresql.Query
        url: jdbc:postgresql://postgres:5432/kestra
        username: kestra
        password: kestra
        sql: |
          INSERT INTO mentorships (id, user_id, mentor_id, goals, status, created_at)
          VALUES (
            '{{ trigger.body.mentorshipId }}',
            '{{ trigger.body.userId }}',
            '{{ trigger.body.mentorId }}',
            '{{ trigger.body.goals | toJson }}',
            'active',
            NOW()
          )

      - id: schedule-first-checkin
        type: io.kestra.core.tasks.executions.Delay
        delay: PT24H # 24 hours

      - id: send-checkin-notification
        type: io.kestra.core.tasks.log.Log
        message: 'Sending check-in notification for mentorship {{ trigger.body.mentorshipId }}'

  - id: daily-checkin-scheduler
    type: io.kestra.core.tasks.schedules.Schedule
    cron: '0 9 * * *' # Daily at 9 AM
    inputs:
      - name: checkin-date
        type: STRING
        value: '{{ trigger.date }}'

    tasks:
      - id: find-active-mentorships
        type: io.kestra.plugin.jdbc.postgresql.Query
        url: jdbc:postgresql://postgres:5432/kestra
        username: kestra
        password: kestra
        sql: |
          SELECT id, user_id, goals 
          FROM mentorships 
          WHERE status = 'active' 
          AND next_check_in <= CURRENT_DATE
        fetch: true

      - id: process-checkins
        type: io.kestra.core.tasks.flows.ForEach
        items: '{{ outputs.find-active-mentorships.rows }}'
        tasks:
          - id: send-notification
            type: io.kestra.core.tasks.log.Log
            message: 'Processing check-in for mentorship {{ taskrun.items.id }}'

          - id: update-next-checkin
            type: io.kestra.plugin.jdbc.postgresql.Query
            url: jdbc:postgresql://postgres:5432/kestra
            username: kestra
            password: kestra
            sql: |
              UPDATE mentorships 
              SET next_check_in = CURRENT_DATE + INTERVAL '7 days'
              WHERE id = '{{ taskrun.items.id }}'
```

## Monitoring and Observability

### Graphile Worker Monitoring

```typescript
// src/workers/monitoring.ts
import { run } from '@graphile/worker';

async function startMonitoring() {
  const runner = await run({
    connectionString: process.env.DATABASE_URL,
    concurrency: 5,
    taskList: mentorshipTasks,

    // Add monitoring
    events: {
      job: async (job) => {
        console.log(`Job ${job.id} (${job.task_identifier}) started`);
      },
      jobSuccess: async (job) => {
        console.log(`Job ${job.id} completed successfully`);
      },
      jobFailure: async (job, error) => {
        console.error(`Job ${job.id} failed:`, error);
        // Send alert on critical failures
        if (job.task_identifier === 'startMentorship') {
          await sendAlert(`Critical mentorship job failed: ${error.message}`);
        }
      },
    },
  });
}
```

### Health Check Endpoints

```typescript
// src/workers/health.ts
import { Pool } from 'pg';

export async function healthCheck(req: Request, res: Response) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // Check database connection
    await pool.query('SELECT 1');

    // Check worker queue health
    const result = await pool.query(`
      SELECT COUNT(*) as pending_jobs 
      FROM graphile_worker.jobs 
      WHERE run_at <= NOW() AND attempts < max_attempts
    `);

    const pendingJobs = parseInt(result.rows[0].pending_jobs);

    res.json({
      status: 'healthy',
      pending_jobs: pendingJobs,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
    });
  } finally {
    await pool.end();
  }
}
```

## Migration Strategies

### From Graphile Worker to Kestra

```bash
# Export existing jobs
psql $DATABASE_URL -c "COPY graphile_worker.jobs TO 'jobs.csv' WITH CSV HEADER"

# Convert to Kestra format
node scripts/convert-to-kestra.js jobs.csv > kestra-flows/migrated-flows.yml
```

### Backup and Recovery

```bash
# Graphile Worker backup
pg_dump $DATABASE_URL --schema=graphile_worker > worker-backup.sql

# Kestra backup
docker exec kestra-postgres pg_dump -U kestra kestra > kestra-backup.sql
```

These deployment guides provide everything needed to get started with each workflow engine, with specific focus on autonomous mentorship use cases.
