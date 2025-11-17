# Autonomous Mentorship - Kestra Setup

## Production Setup (15 minutes)

### 1. Docker Compose Configuration

```yaml
# docker-compose.yml
version: '3.8'
services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: kestra
      POSTGRES_USER: kestra
      POSTGRES_PASSWORD: kestra123
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7
    ports:
      - '6379:6379'
    volumes:
      - redis_data:/data

  kestra:
    image: kestra/kestra:latest
    ports:
      - '8080:8080'
    environment:
      datasources:
        postgres:
          url: jdbc:postgresql://postgres:5432/kestra
          username: kestra
          password: kestra123
      kestra:
        repository:
          type: postgres
        queue:
          type: postgres
        storage:
          type: local
          base-path: /app/storage
    volumes:
      - ./workflows:/app/workflows
      - kestra_storage:/app/storage
    depends_on:
      - postgres
      - redis

volumes:
  postgres_data:
  redis_data:
  kestra_storage:
```

### 2. Start Kestra

```bash
docker-compose up -d
# Wait 30 seconds for startup
curl http://localhost:8080/health
```

### 3. Create Mentorship Workflows

#### Main Mentorship Workflow

```yaml
# workflows/autonomous-mentorship.yml
id: autonomous-mentorship
namespace: mentorship

inputs:
  - id: storyId
    type: STRING
    defaults: 'story-123'
  - id: juniorId
    type: STRING
    defaults: 'junior-456'

tasks:
  - id: init-story-processing
    type: io.kestra.core.tasks.log.Log
    message: '🚀 Starting mentorship for story {{ inputs.storyId }} and junior {{ inputs.juniorId }}'

  - id: create-session
    type: io.kestra.plugin.jdbc.Query
    sql: |
      INSERT INTO mentorship_sessions (story_id, junior_id, current_state, context)
      VALUES ('{{ inputs.storyId }}', '{{ inputs.juniorId }}', 'INIT_STORY_PROCESSING', '{}')
      RETURNING id as session_id;
    url: jdbc:postgresql://postgres:5432/kestra
    username: kestra
    password: kestra123

  - id: assess-junior-capability
    type: io.kestra.core.tasks.flows.WorkingDirectory
    inputFiles:
      assessment.json: |
        {
          "sessionId": "{{ outputs.create-session.rows[0].session_id }}",
          "storyId": "{{ inputs.storyId }}",
          "juniorId": "{{ inputs.juniorId }}",
          "questions": [
            "What do you understand needs to be built?",
            "What technical challenges do you foresee?",
            "What's your planned approach?"
          ]
        }

  - id: send-assessment
    type: io.kestra.plugin.notifications.slack.SlackIncomingWebhook
    url: "{{ secret('SLACK_WEBHOOK') }}"
    payload: |
      {
        "text": "📝 Mentorship Assessment Required",
        "channel": "#{{ inputs.juniorId }}",
        "blocks": [
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": "*Story Assessment Required*\n\nStory: {{ inputs.storyId }}\n\nPlease answer:\n• What do you understand needs to be built?\n• What technical challenges do you foresee?\n• What's your planned approach?"
            }
          }
        ]
      }

  - id: wait-for-response
    type: io.kestra.core.tasks.flows.Pause
    timeout: PT5M # 5 minutes

  - id: check-response
    type: io.kestra.core.tasks.scripts.Bash
    commands:
      - |
        # Check if junior responded via Slack API
        response=$(curl -s "http://localhost:3000/api/slack/check-response?sessionId={{ outputs.create-session.rows[0].session_id }}")
        echo $response > response.json

  - id: process-response
    type: io.kestra.core.tasks.flows.Switch
    value: '{{ outputs.check-response.vars.response }}'
    cases:
      - case: 'correct_understanding'
        tasks:
          - id: plan-decomposition
            type: io.kestra.core.tasks.log.Log
            message: '✅ Junior understands requirements, moving to planning phase'

      - case: 'partial_understanding'
        tasks:
          - id: clarify-requirements
            type: io.kestra.core.tasks.log.Log
            message: '⚠️ Junior has partial understanding, providing clarification'

      - case: 'misunderstanding'
        tasks:
          - id: re-explain-story
            type: io.kestra.core.tasks.log.Log
            message: '❌ Junior misunderstood, re-explaining story'

      - case: 'timeout'
        tasks:
          - id: diagnose-blocker
            type: io.kestra.core.tasks.log.Log
            message: '⏰ Timeout detected, diagnosing blocker'

  - id: start-implementation
    type: io.kestra.core.tasks.log.Log
    message: '🔧 Starting implementation phase'
    runIf: "{{ outputs.process-response.case == 'correct_understanding' }}"

  - id: monitor-progress
    type: io.kestra.core.tasks.flows.EachSequential
    items: ['1', '2', '3', '4', '5'] # 5 monitoring cycles
    value: 'cycle'
    tasks:
      - id: check-activity
        type: io.kestra.core.tasks.scripts.Bash
        commands:
          - |
            echo "Monitoring cycle {{ cycle }} for session {{ outputs.create-session.rows[0].session_id }}"
            # Check git activity, file changes, etc.
            sleep 30  # Wait 30 seconds between checks

      - id: detect-stall
        type: io.kestra.core.tasks.flows.Switch
        value: '{{ outputs.check-activity.exitCode }}'
        cases:
          - case: '0'
            tasks:
              - id: continue-monitoring
                type: io.kestra.core.tasks.log.Log
                message: '✅ Progress detected, continuing monitoring'

          - case: '1'
            tasks:
              - id: handle-stall
                type: io.kestra.core.tasks.log.Log
                message: '⚠️ No progress detected, diagnosing blocker'

  - id: quality-gate-check
    type: io.kestra.core.tasks.log.Log
    message: '🔍 Running quality gate checks'

  - id: run-tests
    type: io.kestra.core.tasks.scripts.Bash
    commands:
      - |
        cd /workspace/{{ inputs.storyId }}
        npm test
        npm run lint
        npm run type-check

  - id: check-quality-gates
    type: io.kestra.core.tasks.flows.Switch
    value: '{{ outputs.run-tests.exitCode }}'
    cases:
      - case: '0'
        tasks:
          - id: prepare-code-review
            type: io.kestra.core.tasks.log.Log
            message: '✅ All quality gates passed, preparing code review'

      - case: '1'
        tasks:
          - id: auto-fix-issues
            type: io.kestra.core.tasks.scripts.Bash
            commands:
              - |
                cd /workspace/{{ inputs.storyId }}
                npm run lint:fix
                npm run format

  - id: create-pull-request
    type: io.kestra.plugin.git.GitClone
    url: 'https://github.com/your-org/your-repo.git'
    branch: 'feature/{{ inputs.storyId }}'
    destination: /tmp/repo

  - id: monitor-review
    type: io.kestra.core.tasks.flows.Pause
    timeout: PT24H # 24 hours for review

  - id: merge-and-complete
    type: io.kestra.core.tasks.log.Log
    message: '🎉 Mentorship completed for story {{ inputs.storyId }}'

triggers:
  - id: mentorship-schedule
    type: io.kestra.core.models.triggers.types.Schedule
    cron: '0 9 * * 1-5' # Weekdays at 9 AM
    inputs:
      storyId: 'auto-assigned-story'
      juniorId: 'available-junior'
```

#### Blocker Resolution Workflow

```yaml
# workflows/blocker-resolution.yml
id: blocker-resolution
namespace: mentorship

inputs:
  - id: sessionId
    type: STRING
  - id: blockerType
    type: STRING
    enum: ['timeout', 'technical_error', 'conceptual_confusion', 'environment_issue']
  - id: currentState
    type: STRING

tasks:
  - id: analyze-blocker
    type: io.kestra.core.tasks.log.Log
    message: '🔧 Analyzing {{ inputs.blockerType }} blocker in state {{ inputs.currentState }}'

  - id: technical-error-resolution
    type: io.kestra.core.tasks.flows.Switch
    value: '{{ inputs.blockerType }}'
    cases:
      - case: 'technical_error'
        tasks:
          - id: parse-error-message
            type: io.kestra.core.tasks.scripts.Bash
            commands:
              - |
                # Get last error from logs
                error=$(grep "ERROR" /var/log/mentorship.log | tail -1)
                echo "Error: $error" > error.json

          - id: provide-fix-command
            type: io.kestra.core.tasks.log.Log
            message: '🔧 Fix command: npm install && npm run build'

      - case: 'timeout'
        tasks:
          - id: analyze-timeout-cause
            type: io.kestra.core.tasks.log.Log
            message: '⏰ Analyzing timeout cause'

          - id: provide-guidance
            type: io.kestra.core.tasks.notifications.slack.SlackIncomingWebhook
            url: "{{ secret('SLACK_WEBHOOK') }}"
            payload: |
              {
                "text": "⏰ Mentorship Timeout",
                "blocks": [
                  {
                    "type": "section",
                    "text": {
                      "type": "mrkdwn",
                      "text": "*Timeout Detected*\n\nYou've been working on this task for a while. Let's try a different approach:\n\n1. Step back and review the requirements\n2. Break down the task into smaller steps\n3. Ask for help if needed"
                    }
                  }
                ]
              }

      - case: 'conceptual_confusion'
        tasks:
          - id: re-explain-concept
            type: io.kestra.core.tasks.log.Log
            message: '📚 Re-explaining concept with examples'

  - id: verify-solution
    type: io.kestra.core.tasks.flows.Pause
    timeout: PT10M # 10 minutes to verify

  - id: resume-mentorship
    type: io.kestra.core.tasks.log.Log
    message: '✅ Blocker resolved, resuming mentorship'
```

### 4. Database Setup

```sql
-- Connect to Kestra database
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Mentorship tables
CREATE TABLE mentorship_sessions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  story_id text NOT NULL,
  junior_id text NOT NULL,
  current_state text NOT NULL,
  context jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE mentorship_events (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id uuid REFERENCES mentorship_sessions(id),
  event_type text NOT NULL,
  event_data jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE mentorship_responses (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id uuid REFERENCES mentorship_sessions(id),
  response_type text NOT NULL,
  response_data jsonb,
  created_at timestamptz DEFAULT now()
);
```

### 5. Start Mentorship Session

```bash
# Access Kestra UI
open http://localhost:8080

# Execute workflow manually or via API
curl -X POST http://localhost:8080/api/v1/executions/autonomous-mentorship \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "inputs": {
      "storyId": "story-123",
      "juniorId": "junior-456"
    }
  }'
```

## Benefits of Kestra Setup

✅ **Professional UI** - Built-in workflow designer and monitoring
✅ **Event-Driven** - Perfect for mentorship state transitions
✅ **YAML Workflows** - Easy to version control and modify
✅ **Scalable** - Kubernetes-ready for team growth
✅ **Integrations** - 100+ plugins for development tools
✅ **Monitoring** - Real-time execution tracking
✅ **Error Handling** - Built-in retry and error recovery

## Resource Requirements

- **CPU**: 2 cores
- **RAM**: 2GB
- **Storage**: 20GB
- **Cost**: ~$20/month on cloud provider

## Next Steps

1. **Configure integrations** (Slack, GitHub, email)
2. **Add more workflows** for each state transition
3. **Set up monitoring** and alerts
4. **Scale to Kubernetes** when team grows

This gives you a production-ready autonomous mentorship platform with professional UI and monitoring!
