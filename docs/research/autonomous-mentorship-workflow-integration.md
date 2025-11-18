# Autonomous Mentorship Workflow Integration Guide

## State Machine Implementation

This document provides specific implementation guidance for integrating workflow engines with the autonomous mentorship state machine design.

## State Machine Architecture

### Core States

```typescript
// src/mentorship/types.ts
export enum MentorshipState {
  INITIALIZING = 'initializing',
  ACTIVE = 'active',
  ASSESSMENT_PENDING = 'assessment_pending',
  ASSESSMENT_IN_PROGRESS = 'assessment_in_progress',
  GOAL_SETTING = 'goal_setting',
  PROGRESS_TRACKING = 'progress_tracking',
  CHECK_IN_REQUIRED = 'check_in_required',
  MENTOR_INTERVENTION = 'mentor_intervention',
  COMPLETION = 'completion',
  PAUSED = 'paused',
  CANCELLED = 'cancelled',
}

export enum MentorshipEvent {
  START = 'start',
  COMPLETE_ASSESSMENT = 'complete_assessment',
  SET_GOALS = 'set_goals',
  SUBMIT_PROGRESS = 'submit_progress',
  REQUEST_MENTOR_HELP = 'request_mentor_help',
  COMPLETE_GOAL = 'complete_goal',
  PAUSE = 'pause',
  RESUME = 'resume',
  CANCEL = 'cancel',
}

export interface StateTransition {
  from: MentorshipState;
  event: MentorshipEvent;
  to: MentorshipState;
  action?: string;
  conditions?: string[];
}
```

### State Transition Rules

```typescript
// src/mentorship/state-machine.ts
export const stateTransitions: StateTransition[] = [
  // Initial flow
  {
    from: MentorshipState.INITIALIZING,
    event: MentorshipEvent.START,
    to: MentorshipState.ASSESSMENT_PENDING,
    action: 'sendInitialAssessment',
  },
  {
    from: MentorshipState.ASSESSMENT_PENDING,
    event: MentorshipEvent.COMPLETE_ASSESSMENT,
    to: MentorshipState.GOAL_SETTING,
    action: 'processAssessmentResults',
  },
  {
    from: MentorshipState.GOAL_SETTING,
    event: MentorshipEvent.SET_GOALS,
    to: MentorshipState.ACTIVE,
    action: 'initializeProgressTracking',
  },

  // Active mentorship flow
  {
    from: MentorshipState.ACTIVE,
    event: MentorshipEvent.SUBMIT_PROGRESS,
    to: MentorshipState.PROGRESS_TRACKING,
    action: 'updateProgress',
  },
  {
    from: MentorshipState.PROGRESS_TRACKING,
    event: MentorshipEvent.REQUEST_MENTOR_HELP,
    to: MentorshipState.MENTOR_INTERVENTION,
    action: 'notifyMentor',
  },
  {
    from: MentorshipState.MENTOR_INTERVENTION,
    event: MentorshipEvent.SUBMIT_PROGRESS,
    to: MentorshipState.ACTIVE,
    action: 'resumeTracking',
  },

  // Completion flow
  {
    from: MentorshipState.ACTIVE,
    event: MentorshipEvent.COMPLETE_GOAL,
    to: MentorshipState.COMPLETION,
    action: 'finalizeMentorship',
  },

  // Pause/Resume flow
  {
    from: MentorshipState.ACTIVE,
    event: MentorshipEvent.PAUSE,
    to: MentorshipState.PAUSED,
    action: 'pauseTracking',
  },
  {
    from: MentorshipState.PAUSED,
    event: MentorshipEvent.RESUME,
    to: MentorshipState.ACTIVE,
    action: 'resumeTracking',
  },
];
```

## Graphile Worker Implementation

### State Management Tasks

```typescript
// src/workers/mentorship-state.ts
import { TaskList } from '@graphile/worker';
import { MentorshipState, MentorshipEvent, stateTransitions } from '../mentorship/types';

export const stateManagementTasks: TaskList = {
  transitionState: async (payload, helpers) => {
    const { mentorshipId, event, eventData } = payload;

    // Get current state
    const currentState = await helpers
      .query(`SELECT state FROM mentorships WHERE id = $1`, [mentorshipId])
      .then((res) => res.rows[0]?.state);

    if (!currentState) {
      throw new Error(`Mentorship ${mentorshipId} not found`);
    }

    // Find valid transition
    const transition = stateTransitions.find((t) => t.from === currentState && t.event === event);

    if (!transition) {
      throw new Error(`Invalid transition from ${currentState} with event ${event}`);
    }

    // Check conditions if any
    if (transition.conditions) {
      for (const condition of transition.conditions) {
        const conditionMet = await checkCondition(condition, mentorshipId, eventData, helpers);
        if (!conditionMet) {
          throw new Error(`Condition ${condition} not met for transition`);
        }
      }
    }

    // Update state
    await helpers.query(
      `UPDATE mentorships 
       SET state = $1, updated_at = NOW() 
       WHERE id = $2`,
      [transition.to, mentorshipId]
    );

    // Execute action if specified
    if (transition.action) {
      await helpers.addJob(transition.action, {
        mentorshipId,
        fromState: currentState,
        toState: transition.to,
        eventData,
      });
    }

    // Schedule next state check if needed
    await scheduleNextStateCheck(mentorshipId, transition.to, helpers);
  },

  sendInitialAssessment: async (payload, helpers) => {
    const { mentorshipId } = payload;

    // Create assessment
    const assessment = await helpers
      .query(
        `INSERT INTO assessments (mentorship_id, type, status, created_at)
       VALUES ($1, 'initial', 'pending', NOW())
       RETURNING id`,
        [mentorshipId]
      )
      .then((res) => res.rows[0]);

    // Send notification
    await helpers.addJob('sendNotification', {
      mentorshipId,
      type: 'assessment_required',
      assessmentId: assessment.id,
    });

    // Set reminder for assessment completion
    await helpers.addJob(
      'assessmentReminder',
      { mentorshipId, assessmentId: assessment.id },
      { runAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) } // 3 days
    );
  },

  processAssessmentResults: async (payload, helpers) => {
    const { mentorshipId, assessmentId, results } = payload;

    // Update assessment
    await helpers.query(
      `UPDATE assessments 
       SET status = 'completed', results = $1, completed_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(results), assessmentId]
    );

    // Analyze results and generate recommendations
    const recommendations = await analyzeAssessmentResults(results, helpers);

    // Update mentorship with assessment insights
    await helpers.query(
      `UPDATE mentorships 
       SET assessment_results = $1, recommendations = $2
       WHERE id = $3`,
      [JSON.stringify(results), JSON.stringify(recommendations), mentorshipId]
    );

    // Trigger goal setting
    await helpers.addJob('triggerGoalSetting', {
      mentorshipId,
      recommendations,
    });
  },

  initializeProgressTracking: async (payload, helpers) => {
    const { mentorshipId, goals } = payload;

    // Save goals
    for (const goal of goals) {
      await helpers.query(
        `INSERT INTO goals (mentorship_id, title, description, target_date, status, created_at)
         VALUES ($1, $2, $3, $4, 'active', NOW())`,
        [mentorshipId, goal.title, goal.description, goal.targetDate]
      );
    }

    // Schedule first check-in
    await helpers.addJob(
      'scheduleCheckIn',
      { mentorshipId },
      { runAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } // 1 week
    );

    // Send welcome to active mentorship
    await helpers.addJob('sendNotification', {
      mentorshipId,
      type: 'mentorship_active',
      goals: goals.map((g) => g.title),
    });
  },

  scheduleCheckIn: async (payload, helpers) => {
    const { mentorshipId } = payload;

    // Check if mentorship is still active
    const mentorship = await helpers
      .query(`SELECT state FROM mentorships WHERE id = $1`, [mentorshipId])
      .then((res) => res.rows[0]);

    if (!mentorship || mentorship.state !== MentorshipState.ACTIVE) {
      return; // Don't schedule check-ins for inactive mentorships
    }

    // Send check-in notification
    await helpers.addJob('sendNotification', {
      mentorshipId,
      type: 'check_in_required',
    });

    // Schedule next check-in
    await helpers.addJob(
      'scheduleCheckIn',
      { mentorshipId },
      { runAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } // 1 week
    );
  },
};

async function checkCondition(
  condition: string,
  mentorshipId: string,
  eventData: any,
  helpers: any
): Promise<boolean> {
  switch (condition) {
    case 'assessment_completed':
      const assessment = await helpers
        .query(`SELECT status FROM assessments WHERE mentorship_id = $1 AND type = 'initial'`, [
          mentorshipId,
        ])
        .then((res) => res.rows[0]);
      return assessment?.status === 'completed';

    case 'goals_set':
      const goals = await helpers
        .query(`SELECT COUNT(*) as count FROM goals WHERE mentorship_id = $1`, [mentorshipId])
        .then((res) => parseInt(res.rows[0].count));
      return goals > 0;

    case 'mentor_available':
      // Check if mentor is available for intervention
      const mentor = await helpers
        .query(
          `SELECT available FROM mentors m 
         JOIN mentorships ms ON m.id = ms.mentor_id 
         WHERE ms.id = $1`,
          [mentorshipId]
        )
        .then((res) => res.rows[0]);
      return mentor?.available === true;

    default:
      return true;
  }
}

async function scheduleNextStateCheck(mentorshipId: string, state: MentorshipState, helpers: any) {
  // Schedule state-specific checks
  switch (state) {
    case MentorshipState.ASSESSMENT_PENDING:
      await helpers.addJob(
        'checkAssessmentCompletion',
        { mentorshipId },
        { runAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } // 1 day
      );
      break;

    case MentorshipState.ACTIVE:
      await helpers.addJob(
        'checkProgressStagnation',
        { mentorshipId },
        { runAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) } // 2 weeks
      );
      break;
  }
}
```

### Event Handlers

```typescript
// src/workers/event-handlers.ts
export const eventHandlerTasks: TaskList = {
  handleUserEvent: async (payload, helpers) => {
    const { userId, eventType, eventData } = payload;

    // Find active mentorships for user
    const mentorships = await helpers
      .query(
        `SELECT id FROM mentorships WHERE user_id = $1 AND state IN ('active', 'assessment_pending', 'goal_setting')`,
        [userId]
      )
      .then((res) => res.rows);

    for (const mentorship of mentorships) {
      await helpers.addJob('transitionState', {
        mentorshipId: mentorship.id,
        event: eventType,
        eventData,
      });
    }
  },

  handleTimeBasedEvent: async (payload, helpers) => {
    const { eventType, scheduledTime } = payload;

    // Find all mentorships that need this time-based event
    const mentorships = await helpers
      .query(`SELECT id FROM mentorships WHERE state = 'active' AND next_check_in <= $1`, [
        scheduledTime,
      ])
      .then((res) => res.rows);

    for (const mentorship of mentorships) {
      await helpers.addJob('transitionState', {
        mentorshipId: mentorship.id,
        event: MentorshipEvent.SUBMIT_PROGRESS,
        eventData: { type: 'scheduled_check_in' },
      });
    }
  },
};
```

## Kestra Implementation

### Mentorship Flow with State Management

```yaml
# kestra-flows/mentorship-state-machine.yml
id: mentorship-state-machine
namespace: tamma.mentorship

inputs:
  - name: mentorshipId
    type: STRING
  - name: userId
    type: STRING
  - name: event
    type: STRING
  - name: eventData
    type: JSON
    defaults: '{}'

tasks:
  - id: get-current-state
    type: io.kestra.plugin.jdbc.postgresql.Query
    url: jdbc:postgresql://postgres:5432/kestra
    username: kestra
    password: kestra
    sql: |
      SELECT state FROM mentorships WHERE id = '{{ inputs.mentorshipId }}'
    fetch: true
    store: true

  - id: validate-transition
    type: io.kestra.core.tasks.scripts.Bash
    inputFiles:
      validate.py: |
        import json
        import sys

        current_state = '{{ outputs.get-current-state.rows[0].state }}'
        event = '{{ inputs.event }}'

        # Define valid transitions (simplified for example)
        transitions = {
            'initializing': {'start': 'assessment_pending'},
            'assessment_pending': {'complete_assessment': 'goal_setting'},
            'goal_setting': {'set_goals': 'active'},
            'active': {'submit_progress': 'progress_tracking', 'pause': 'paused'},
            'paused': {'resume': 'active'}
        }

        if current_state in transitions and event in transitions[current_state]:
            new_state = transitions[current_state][event]
            print(f"VALID:{new_state}")
        else:
            print("INVALID")
            sys.exit(1)
    commands:
      - python validate.py

  - id: update-state
    type: io.kestra.plugin.jdbc.postgresql.Query
    url: jdbc:postgresql://postgres:5432/kestra
    username: kestra
    password: kestra
    sql: |
      UPDATE mentorships 
      SET state = '{{ outputs.validate-transition.exitCode == 0 ? outputs.validate-transition.output.split(":")[1] : outputs.get-current-state.rows[0].state }}',
          updated_at = NOW()
      WHERE id = '{{ inputs.mentorshipId }}'

  - id: execute-state-action
    type: io.kestra.core.tasks.flows.Switch
    value: "{{ outputs.validate-transition.output.split(':')[1] }}"
    cases:
      assessment_pending:
        - id: send-assessment
          type: io.kestra.core.tasks.log.Log
          message: 'Sending initial assessment for {{ inputs.mentorshipId }}'

      goal_setting:
        - id: process-assessment
          type: io.kestra.core.tasks.log.Log
          message: 'Processing assessment results for {{ inputs.mentorshipId }}'

      active:
        - id: start-tracking
          type: io.kestra.core.tasks.log.Log
          message: 'Starting progress tracking for {{ inputs.mentorshipId }}'
```

### Event-Driven Triggers

```yaml
# kestra-flows/mentorship-events.yml
id: mentorship-event-handlers
namespace: tamma.mentorship

triggers:
  - id: user-event-webhook
    type: io.kestra.core.models.triggers.types.Webhook
    key: mentorship-user-event
    inputs:
      - name: userId
        type: STRING
      - name: eventType
        type: STRING
      - name: eventData
        type: JSON

  - id: scheduled-checkins
    type: io.kestra.core.models.triggers.types.Schedule
    cron: '0 9 * * *' # Daily at 9 AM

tasks:
  - id: find-mentorships
    type: io.kestra.plugin.jdbc.postgresql.Query
    url: jdbc:postgresql://postgres:5432/kestra
    username: kestra
    password: kestra
    sql: |
      SELECT id FROM mentorships 
      WHERE user_id = '{{ trigger.userId }}' 
      AND state IN ('active', 'assessment_pending', 'goal_setting')
    fetch: true

  - id: process-events
    type: io.kestra.core.tasks.flows.ForEach
    items: '{{ outputs.find-mentorships.rows }}'
    tasks:
      - id: trigger-state-transition
        type: io.kestra.core.tasks.flows.Flow
        flowId: mentorship-state-machine
        namespace: tamma.mentorship
        inputs:
          mentorshipId: '{{ taskrun.items.id }}'
          userId: '{{ trigger.userId }}'
          event: '{{ trigger.eventType }}'
          eventData: '{{ trigger.eventData }}'
        wait: false
```

## Database Schema for State Management

```sql
-- Mentorships table with state tracking
CREATE TABLE mentorships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  mentor_id UUID NOT NULL REFERENCES mentors(id),
  state VARCHAR(50) NOT NULL DEFAULT 'initializing',
  assessment_results JSONB,
  recommendations JSONB,
  goals JSONB,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  paused_at TIMESTAMPTZ,
  next_check_in TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- State transitions log
CREATE TABLE mentorship_state_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentorship_id UUID NOT NULL REFERENCES mentorships(id),
  from_state VARCHAR(50) NOT NULL,
  event VARCHAR(50) NOT NULL,
  to_state VARCHAR(50) NOT NULL,
  event_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Assessments table
CREATE TABLE assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentorship_id UUID NOT NULL REFERENCES mentorships(id),
  type VARCHAR(50) NOT NULL, -- 'initial', 'progress', 'final'
  status VARCHAR(50) NOT NULL DEFAULT 'pending', -- 'pending', 'in_progress', 'completed'
  questions JSONB NOT NULL,
  results JSONB,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Goals table
CREATE TABLE goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentorship_id UUID NOT NULL REFERENCES mentorships(id),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  target_date TIMESTAMPTZ,
  status VARCHAR(50) NOT NULL DEFAULT 'active', -- 'active', 'completed', 'paused'
  progress INTEGER DEFAULT 0, -- 0-100
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Progress updates table
CREATE TABLE progress_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentorship_id UUID NOT NULL REFERENCES mentorships(id),
  goal_id UUID REFERENCES goals(id),
  update_type VARCHAR(50) NOT NULL, -- 'check_in', 'milestone', 'issue'
  content TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX ON mentorships (user_id, state);
CREATE INDEX ON mentorships (state, next_check_in);
CREATE INDEX ON mentorship_state_transitions (mentorship_id, created_at);
CREATE INDEX ON assessments (mentorship_id, status);
CREATE INDEX ON goals (mentorship_id, status);
CREATE INDEX ON progress_updates (mentorship_id, created_at);
```

## Testing the State Machine

### Unit Tests

```typescript
// src/workers/__tests__/state-machine.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { stateTransitions } from '../mentorship/types';
import { stateManagementTasks } from '../mentorship-state';

describe('Mentorship State Machine', () => {
  it('should validate state transitions', () => {
    const validTransition = stateTransitions.find(
      (t) => t.from === 'initializing' && t.event === 'start'
    );

    expect(validTransition).toBeDefined();
    expect(validTransition?.to).toBe('assessment_pending');
  });

  it('should reject invalid transitions', () => {
    const invalidTransition = stateTransitions.find(
      (t) => t.from === 'initializing' && t.event === 'complete_goal'
    );

    expect(invalidTransition).toBeUndefined();
  });
});
```

### Integration Tests

```typescript
// src/workers/__tests__/integration.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { run } from '@graphile/worker';
import { stateManagementTasks } from '../mentorship-state';

describe('State Machine Integration', () => {
  let workerRunner: any;

  beforeEach(async () => {
    workerRunner = await run({
      connectionString: process.env.TEST_DATABASE_URL,
      concurrency: 1,
      taskList: stateManagementTasks,
    });
  });

  afterEach(async () => {
    await workerRunner.stop();
  });

  it('should complete full mentorship flow', async () => {
    // Test the complete flow from initialization to completion
    // This would involve adding jobs and checking state transitions
  });
});
```

This integration guide provides the specific implementation details needed to connect workflow engines with the autonomous mentorship state machine, ensuring proper state management, event handling, and progress tracking.
