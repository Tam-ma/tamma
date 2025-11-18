# Tamma Engine Implementation Plan using ELSA

## 🎯 Project Overview

**Objective**: Build the Tamma autonomous mentorship engine using ELSA Workflows as the foundation, implementing the complete 20+ state machine we designed in our UML diagram.

**Architecture**: ELSA Core + Custom Mentorship Activities + Integration Layer + Monitoring Dashboard

---

## 📋 Implementation Phases

### **Phase 1: Foundation Setup (Week 1-2)**

**Goal**: Deploy ELSA and establish basic infrastructure

#### 1.1 Infrastructure Setup

```yaml
# docker-compose.prod.yml
version: '3.8'
services:
  elsa-server:
    image: elsaworkflows/elsa-core:latest
    ports:
      - '5000:5000'
    environment:
      - ConnectionStrings__DefaultConnection=Server=postgres;Database=tamma;User Id=tamma;Password=tamma123;
      - RabbitMq__HostName=rabbitmq
      - RabbitMq__Username=tamma
      - RabbitMq__Password=tamma123
      - Logging__LogLevel__Default=Information
      - Elsa__Server__BaseUrl=https://tamma.yourcompany.com
    depends_on:
      - postgres
      - rabbitmq
    volumes:
      - ./workflows:/app/workflows
      - ./activities:/app/activities
      - ./data:/app/storage

  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: tamma
      POSTGRES_USER: tamma
      POSTGRES_PASSWORD: tamma123
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data

  rabbitmq:
    image: rabbitmq:3-management
    ports:
      - '5672:5672'
      - '15672:15672'
    environment:
      RABBITMQ_DEFAULT_USER: tamma
      RABBITMQ_DEFAULT_PASS: tamma123
    volumes:
      - rabbitmq_data:/var/lib/rabbitmq

  tamma-api:
    build: ./src/Tamma.Api
    ports:
      - '3000:3000'
    environment:
      - ELSA_SERVER_URL=http://elsa-server:5000
      - DATABASE_URL=postgresql://tamma:tamma123@postgres:5432/tamma
      - SLACK_WEBHOOK=${SLACK_WEBHOOK}
      - GITHUB_TOKEN=${GITHUB_TOKEN}
    depends_on:
      - elsa-server
      - postgres

  tamma-dashboard:
    build: ./src/Tamma.Dashboard
    ports:
      - '3001:3000'
    environment:
      - API_URL=http://tamma-api:3000
    depends_on:
      - tamma-api

volumes:
  postgres_data:
  rabbitmq_data:
```

#### 1.2 Project Structure

```
tamma-engine/
├── src/
│   ├── Tamma.Activities/          # Custom ELSA activities
│   │   ├── Mentorship/
│   │   │   ├── AssessJuniorCapabilityActivity.cs
│   │   │   ├── MonitorImplementationActivity.cs
│   │   │   ├── DiagnoseBlockerActivity.cs
│   │   │   ├── QualityGateCheckActivity.cs
│   │   │   ├── CodeReviewActivity.cs
│   │   │   └── MergeCompleteActivity.cs
│   │   ├── Integration/
│   │   │   ├── GitHubActivity.cs
│   │   │   ├── SlackActivity.cs
│   │   │   ├── EmailActivity.cs
│   │   │   └── JiraActivity.cs
│   │   └── AI/
│   │       ├── AnalyzeResponseActivity.cs
│   │       ├── DetectPatternActivity.cs
│   │       ├── GenerateGuidanceActivity.cs
│   │       └── PersonalizeMentorshipActivity.cs
│   ├── Tamma.Api/               # REST API for external integrations
│   │   ├── Controllers/
│   │   │   ├── MentorshipController.cs
│   │   │   ├── WebhookController.cs
│   │   │   └── AnalyticsController.cs
│   │   ├── Services/
│   │   │   ├── IElsaWorkflowService.cs
│   │   │   ├── ICommunicationService.cs
│   │   │   └── IAnalyticsService.cs
│   │   └── Models/
│   │       ├── MentorshipSession.cs
│   │       ├── StoryContext.cs
│   │       └── JuniorProfile.cs
│   ├── Tamma.Dashboard/          # React dashboard for monitoring
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── MentorshipFlow.tsx
│   │   │   │   ├── SessionMonitor.tsx
│   │   │   │   ├── AnalyticsDashboard.tsx
│   │   │   │   └── JuniorProgress.tsx
│   │   │   ├── services/
│   │   │   │   └── tammaApi.ts
│   │   │   └── types/
│   │   │       └── mentorship.ts
│   │   └── package.json
│   ├── Tamma.Core/              # Domain models and interfaces
│   │   ├── Entities/
│   │   │   ├── MentorshipSession.cs
│   │   │   ├── Story.cs
│   │   │   ├── JuniorDeveloper.cs
│   │   │   └── MentorshipEvent.cs
│   │   ├── Enums/
│   │   │   ├── MentorshipState.cs
│   │   │   ├── BlockerType.cs
│   │   │   ├── AssessmentResult.cs
│   │   │   └── QualityGateResult.cs
│   │   └── Interfaces/
│   │       ├── IMentorshipService.cs
│   │       ├── IIntegrationService.cs
│   │       └── IAnalyticsService.cs
│   └── Tamma.Data/              # Database context and migrations
│       ├── Migrations/
│       ├── TammaDbContext.cs
│       └── Repositories/
│           ├── IMentorshipSessionRepository.cs
│           └── MentorshipSessionRepository.cs
├── workflows/                    # ELSA workflow definitions
│   ├── autonomous-mentorship.json
│   ├── blocker-resolution.json
│   ├── quality-gate.json
│   └── code-review.json
├── activities/                   # Custom activity assemblies
├── tests/                       # Unit and integration tests
│   ├── Tamma.Activities.Tests/
│   ├── Tamma.Api.Tests/
│   └── Tamma.Core.Tests/
├── docs/                        # Documentation
├── scripts/                      # Deployment and utility scripts
├── docker-compose.yml
├── docker-compose.prod.yml
└── README.md
```

#### 1.3 Database Schema

```sql
-- Tamma Database Schema
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Core Entities
CREATE TABLE mentorship_sessions (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    story_id text NOT NULL,
    junior_id text NOT NULL,
    current_state text NOT NULL,
    previous_state text,
    context jsonb DEFAULT '{}',
    variables jsonb DEFAULT '{}',
    workflow_instance_id text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    completed_at timestamptz,
    status text DEFAULT 'active' CHECK (status IN ('active', 'completed', 'failed', 'paused'))
);

CREATE TABLE mentorship_events (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id uuid REFERENCES mentorship_sessions(id) ON DELETE CASCADE,
    event_type text NOT NULL,
    event_data jsonb,
    state_from text,
    state_to text,
    trigger text,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE junior_developers (
    id text PRIMARY KEY,
    name text NOT NULL,
    email text,
    slack_id text,
    github_username text,
    skill_level integer DEFAULT 1 CHECK (skill_level >= 1 AND skill_level <= 5),
    preferences jsonb DEFAULT '{}',
    learning_patterns jsonb DEFAULT '[]',
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE stories (
    id text PRIMARY KEY,
    title text NOT NULL,
    description text,
    acceptance_criteria jsonb DEFAULT '[]',
    technical_requirements jsonb DEFAULT '{}',
    priority integer DEFAULT 3 CHECK (priority >= 1 AND priority <= 5),
    complexity integer DEFAULT 3 CHECK (complexity >= 1 AND complexity <= 5),
    estimated_hours integer,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE mentorship_analytics (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id uuid REFERENCES mentorship_sessions(id),
    metric_name text NOT NULL,
    metric_value numeric,
    metric_unit text,
    recorded_at timestamptz DEFAULT now()
);

-- Indexes for performance
CREATE INDEX idx_mentorship_sessions_junior_id ON mentorship_sessions(junior_id);
CREATE INDEX idx_mentorship_sessions_current_state ON mentorship_sessions(current_state);
CREATE INDEX idx_mentorship_sessions_created_at ON mentorship_sessions(created_at);
CREATE INDEX idx_mentorship_events_session_id ON mentorship_events(session_id);
CREATE INDEX idx_mentorship_events_created_at ON mentorship_events(created_at);
```

---

### **Phase 2: Core Mentorship Activities (Week 3-4)**

**Goal**: Implement all custom activities for the state machine

#### 2.1 State Management Activities

**AssessJuniorCapabilityActivity.cs**

```csharp
using Elsa.ActivityResults;
using Elsa.Attributes;
using Elsa.Services;
using Tamma.Core.Enums;
using Tamma.Core.Models;
using System.Threading.Tasks;

namespace Tamma.Activities.Mentorship
{
    [Activity(
        DisplayName = "Assess Junior Capability",
        Category = "Tamma Mentorship",
        Description = "Evaluate junior developer's understanding of story requirements",
        Outcomes = new[] { "Correct", "Partial", "Incorrect", "Timeout" }
    )]
    public class AssessJuniorCapabilityActivity : Activity
    {
        private readonly ICommunicationService _communicationService;
        private readonly IAIAnalysisService _aiService;
        private readonly IMentorshipRepository _repository;

        [ActivityInput(
            Label = "Story ID",
            Description = "ID of the story to assess"
        )]
        public string StoryId { get; set; }

        [ActivityInput(
            Label = "Junior ID",
            Description = "ID of the junior developer"
        )]
        public string JuniorId { get; set; }

        [ActivityInput(
            Label = "Session ID",
            Description = "Mentorship session ID"
        )]
        public string SessionId { get; set; }

        [ActivityOutput(
            Label = "Assessment Result",
            Description = "Result of the capability assessment"
        )]
        public AssessmentResult Result { get; set; }

        [ActivityOutput(
            Label = "Next State",
            Description = "Next state in the mentorship flow"
        )]
        public string NextState { get; set; }

        protected override async ValueTask<IActivityExecutionResult> OnExecuteAsync(ActivityExecutionContext context)
        {
            try
            {
                // Get story and junior information
                var story = await _repository.GetStoryAsync(StoryId);
                var junior = await _repository.GetJuniorAsync(JuniorId);

                // Send assessment questions
                var assessmentRequest = new AssessmentRequest
                {
                    StoryId = StoryId,
                    StoryTitle = story.Title,
                    StoryDescription = story.Description,
                    AcceptanceCriteria = story.AcceptanceCriteria,
                    JuniorId = JuniorId,
                    JuniorName = junior.Name,
                    Questions = new[]
                    {
                        "What do you understand needs to be built?",
                        "What technical challenges do you foresee?",
                        "What's your planned approach?",
                        "What technologies will you use?"
                    },
                    Timeout = TimeSpan.FromMinutes(5),
                    Difficulty = story.Complexity
                };

                await _communicationService.SendAssessmentAsync(assessmentRequest);

                // Update session state
                await _repository.UpdateSessionStateAsync(SessionId, MentorshipState.ASSESS_JUNIOR_CAPABILITY);

                // Wait for response with timeout
                var responseTask = _communicationService.WaitForResponseAsync(JuniorId, StoryId);
                var timeoutTask = Task.Delay(assessmentRequest.Timeout);

                var completedTask = await Task.WhenAny(responseTask, timeoutTask);

                AssessmentResult result;
                if (completedTask == timeoutTask)
                {
                    // Handle timeout
                    result = new AssessmentResult
                    {
                        Status = AssessmentStatus.Timeout,
                        Confidence = 0.0,
                        Gaps = new[] { "No response received" },
                        NextState = MentorshipState.DIAGNOSE_BLOCKER
                    };

                    await _communicationService.SendTimeoutNotificationAsync(JuniorId, StoryId);
                }
                else
                {
                    // Analyze response using AI
                    var response = await responseTask;
                    result = await _aiService.AnalyzeAssessmentResponseAsync(response, story);

                    // Log assessment event
                    await _repository.LogEventAsync(SessionId, "assessment_completed", new
                    {
                        assessmentStatus = result.Status.ToString(),
                        confidence = result.Confidence,
                        gaps = result.Gaps,
                        responseTime = DateTime.UtcNow
                    });
                }

                // Set outputs
                Result = result;
                NextState = result.NextState.ToString();

                // Return appropriate outcome
                return Outcome(result.NextState.ToString(), result);
            }
            catch (Exception ex)
            {
                await _repository.LogEventAsync(SessionId, "assessment_error", new { error = ex.Message });
                return Fault("Failed to assess junior capability", ex);
            }
        }
    }
}
```

**MonitorImplementationActivity.cs**

```csharp
[Activity(
    DisplayName = "Monitor Implementation Progress",
    Category = "Tamma Mentorship",
    Description = "Monitor junior developer's implementation progress and detect issues",
    Outcomes = new[] { "Steady", "Slowing", "Stalled", "Circular", "Complete" }
)]
public class MonitorImplementationActivity : Activity
{
    private readonly IGitService _gitService;
    private readonly ICommunicationService _communicationService;
    private readonly IAIAnalysisService _aiService;
    private readonly IMentorshipRepository _repository;

    [ActivityInput(Label = "Session ID")]
    public string SessionId { get; set; }

    [ActivityInput(Label = "Story ID")]
    public string StoryId { get; set; }

    [ActivityInput(Label = "Junior ID")]
    public string JuniorId { get; set; }

    [ActivityInput(
        Label = "Monitoring Duration",
        Description = "How long to monitor (in minutes)",
        DefaultValue = "60"
    )]
    public int MonitoringDuration { get; set; } = 60;

    [ActivityOutput(Label = "Progress Status")]
    public ProgressStatus Status { get; set; }

    [ActivityOutput(Label = "Next State")]
    public string NextState { get; set; }

    protected override async ValueTask<IActivityExecutionResult> OnExecuteAsync(ActivityExecutionContext context)
    {
        var session = await _repository.GetSessionAsync(SessionId);
        var startTime = DateTime.UtcNow;
        var checkInterval = TimeSpan.FromMinutes(5);
        var maxStallTime = TimeSpan.FromMinutes(15);

        while (DateTime.UtcNow - startTime < TimeSpan.FromMinutes(MonitoringDuration))
        {
            // Collect progress data
            var progressData = await CollectProgressData(StoryId, JuniorId);

            // Analyze progress patterns
            var analysis = await AnalyzeProgress(progressData, session);

            // Update session with progress
            await _repository.UpdateSessionContextAsync(SessionId, new
            {
                lastProgressCheck = DateTime.UtcNow,
                progressData = progressData,
                progressAnalysis = analysis
            });

            switch (analysis.Status)
            {
                case ProgressAnalysisStatus.Steady:
                    await Task.Delay(checkInterval);
                    continue;

                case ProgressAnalysisStatus.Slowing:
                    await SendEncouragement(JuniorId, analysis);
                    await Task.Delay(checkInterval);
                    continue;

                case ProgressAnalysisStatus.Stalled:
                    Status = new ProgressStatus
                    {
                        Status = "STALLED",
                        Reason = analysis.Reason,
                        LastActivity = progressData.LastActivity,
                        NextState = MentorshipState.DIAGNOSE_BLOCKER
                    };
                    NextState = MentorshipState.DIAGNOSE_BLOCKER.ToString();
                    return Outcome("Stalled", Status);

                case ProgressAnalysisStatus.Circular:
                    Status = new ProgressStatus
                    {
                        Status = "CIRCULAR",
                        Pattern = analysis.DetectedPattern,
                        RepetitionCount = analysis.RepetitionCount,
                        NextState = MentorshipState.DETECT_PATTERN
                    };
                    NextState = MentorshipState.DETECT_PATTERN.ToString();
                    return Outcome("Circular", Status);

                case ProgressAnalysisStatus.Complete:
                    Status = new ProgressStatus
                    {
                        Status = "COMPLETE",
                        CompletionPercentage = 100,
                        NextState = MentorshipState.QUALITY_GATE_CHECK
                    };
                    NextState = MentorshipState.QUALITY_GATE_CHECK.ToString();
                    return Outcome("Complete", Status);
            }
        }

        // Monitoring duration exceeded
        Status = new ProgressStatus
        {
            Status = "TIMEOUT",
            Reason = "Monitoring duration exceeded",
            NextState = MentorshipState.DIAGNOSE_BLOCKER
        };
        NextState = MentorshipState.DIAGNOSE_BLOCKER.ToString();

        return Outcome("Timeout", Status);
    }

    private async Task<ImplementationProgress> CollectProgressData(string storyId, string juniorId)
    {
        var gitActivity = await _gitService.GetRecentActivityAsync(juniorId, storyId, TimeSpan.FromHours(1));
        var testResults = await _gitService.GetTestResultsAsync(juniorId, storyId);
        var buildStatus = await _gitService.GetBuildStatusAsync(juniorId, storyId);

        return new ImplementationProgress
        {
            StoryId = storyId,
            JuniorId = juniorId,
            Commits = gitActivity.Commits,
            FileChanges = gitActivity.FileChanges,
            LastActivity = gitActivity.LastActivity,
            TestResults = testResults,
            BuildStatus = buildStatus,
            Timestamp = DateTime.UtcNow
        };
    }

    private async Task<ProgressAnalysis> AnalyzeProgress(ImplementationProgress progress, MentorshipSession session)
    {
        // Check for no activity
        if (progress.LastActivity < DateTime.UtcNow.AddMinutes(-10))
        {
            return new ProgressAnalysis
            {
                Status = ProgressAnalysisStatus.Stalled,
                Reason = "No activity for 10+ minutes"
            };
        }

        // Check for circular behavior
        var circularPattern = DetectCircularBehavior(progress, session);
        if (circularPattern.IsCircular)
        {
            return new ProgressAnalysis
            {
                Status = ProgressAnalysisStatus.Circular,
                DetectedPattern = circularPattern.Pattern,
                RepetitionCount = circularPattern.Count,
                Reason = "Circular behavior detected"
            };
        }

        // Calculate progress rate
        var progressRate = CalculateProgressRate(progress, session);
        if (progressRate < 0.1) // Less than 10% progress per hour
        {
            return new ProgressAnalysis
            {
                Status = ProgressAnalysisStatus.Slowing,
                Reason = "Progress rate too slow",
                ProgressRate = progressRate
            };
        }

        // Check if implementation is complete
        if (progress.BuildStatus == "Success" &&
            progress.TestResults.All(t => t.Status == "Passed"))
        {
            return new ProgressAnalysis
            {
                Status = ProgressAnalysisStatus.Complete,
                Reason = "All tests passing and build successful"
            };
        }

        return new ProgressAnalysis
        {
            Status = ProgressAnalysisStatus.Steady,
            Reason = "Progress is steady",
            ProgressRate = progressRate
        };
    }

    private CircularPattern DetectCircularBehavior(ImplementationProgress progress, MentorshipSession session)
    {
        var context = session.Context;
        var previousProgress = context.GetProperty<ImplementationProgress>("progressData");

        if (previousProgress == null)
            return new CircularPattern { IsCircular = false };

        // Check for repeated test failures
        var repeatedTestFailures = progress.TestResults
            .Where(t => t.Status == "Failed")
            .GroupBy(t => t.TestName)
            .Where(g => g.Count() >= 3)
            .Select(g => g.Key)
            .ToList();

        if (repeatedTestFailures.Any())
        {
            return new CircularPattern
            {
                IsCircular = true,
                Pattern = $"Same test failing repeatedly: {string.Join(", ", repeatedTestFailures)}",
                Count = repeatedTestFailures.Max(f => progress.TestResults.Count(t => t.TestName == f))
            };
        }

        // Check for repeated build errors
        if (progress.BuildStatus == "Failed" &&
            previousProgress.BuildStatus == "Failed")
        {
            return new CircularPattern
            {
                IsCircular = true,
                Pattern = "Same build error recurring",
                Count = 2
            };
        }

        // Check for repeated file changes
        var repeatedChanges = progress.FileChanges
            .GroupBy(f => f.FilePath)
            .Where(g => g.Count() >= 5)
            .Select(g => g.Key)
            .ToList();

        if (repeatedChanges.Any())
        {
            return new CircularPattern
            {
                IsCircular = true,
                Pattern = $"Same files being modified repeatedly: {string.Join(", ", repeatedChanges)}",
                Count = repeatedChanges.Max(f => progress.FileChanges.Count(c => c.FilePath == f))
            };
        }

        return new CircularPattern { IsCircular = false };
    }

    private async Task SendEncouragement(string juniorId, ProgressAnalysis analysis)
    {
        var encouragement = await _aiService.GenerateEncouragementAsync(juniorId, analysis);
        await _communicationService.SendEncouragementAsync(juniorId, encouragement);
    }
}
```

#### 2.2 Integration Activities

**GitHubIntegrationActivity.cs**

```csharp
[Activity(
    DisplayName = "GitHub Integration",
    Category = "Tamma Integrations",
    Description = "Integrate with GitHub for repository operations"
)]
public class GitHubIntegrationActivity : Activity
{
    private readonly IGitHubService _gitHubService;

    [ActivityInput(
        Label = "Action",
        Description = "GitHub action to perform"
    )]
    public GitHubAction Action { get; set; }

    [ActivityInput(Label = "Repository")]
    public string Repository { get; set; }

    [ActivityInput(Label = "Story ID")]
    public string StoryId { get; set; }

    [ActivityInput(Label = "Junior ID")]
    public string JuniorId { get; set; }

    [ActivityInput(Label = "Branch Name")]
    public string BranchName { get; set; }

    [ActivityOutput(Label = "Result")]
    public GitHubOperationResult Result { get; set; }

    protected override async ValueTask<IActivityExecutionResult> OnExecuteAsync(ActivityExecutionContext context)
    {
        try
        {
            GitHubOperationResult result;

            switch (Action)
            {
                case GitHubAction.CreateBranch:
                    result = await CreateFeatureBranch();
                    break;

                case GitHubAction.MonitorCommits:
                    result = await MonitorCommits();
                    break;

                case GitHubAction.CreatePullRequest:
                    result = await CreatePullRequest();
                    break;

                case GitHubAction.MergePullRequest:
                    result = await MergePullRequest();
                    break;

                case GitHubAction.GetFileChanges:
                    result = await GetFileChanges();
                    break;

                case GitHubAction.RunTests:
                    result = await RunTests();
                    break;

                default:
                    throw new ArgumentException($"Unsupported GitHub action: {Action}");
            }

            Result = result;
            return Done(result);
        }
        catch (Exception ex)
        {
            return Fault("GitHub operation failed", ex);
        }
    }

    private async Task<GitHubOperationResult> CreateFeatureBranch()
    {
        var branchName = string.IsNullOrEmpty(BranchName)
            ? $"feature/{StoryId}"
            : BranchName;

        var result = await _gitHubService.CreateBranchAsync(Repository, branchName);

        return new GitHubOperationResult
        {
            Success = result.Success,
            Message = result.Success
                ? $"Created branch: {branchName}"
                : $"Failed to create branch: {result.Error}",
            Data = new { branchName, url = result.BranchUrl }
        };
    }

    private async Task<GitHubOperationResult> MonitorCommits()
    {
        var branchName = $"feature/{StoryId}";
        var commits = await _gitHubService.GetCommitsAsync(Repository, branchName, since: DateTime.UtcNow.AddHours(-1));

        return new GitHubOperationResult
        {
            Success = true,
            Message = $"Found {commits.Count} commits in the last hour",
            Data = new { commitCount = commits.Count, commits = commits }
        };
    }

    private async Task<GitHubOperationResult> CreatePullRequest()
    {
        var branchName = $"feature/{StoryId}";
        var pullRequest = await _gitHubService.CreatePullRequestAsync(Repository, new
        {
            title = $"Feature: {StoryId}",
            head = branchName,
            base = "main",
            body = GeneratePullRequestBody()
        });

        return new GitHubOperationResult
        {
            Success = pullRequest.Success,
            Message = pullRequest.Success
                ? $"Created pull request: {pullRequest.Number}"
                : $"Failed to create PR: {pullRequest.Error}",
            Data = new { pullRequestNumber = pullRequest.Number, url = pullRequest.Url }
        };
    }

    private string GeneratePullRequestBody()
    {
        return $@"
## Summary
Implementation of story {StoryId} by junior developer {JuniorId}.

## Changes
- [ ] Feature implementation
- [ ] Unit tests
- [ ] Integration tests
- [ ] Documentation updates

## Testing
- All unit tests passing
- Integration tests passing
- Manual testing completed

## Checklist
- [ ] Code follows project standards
- [ ] Self-reviewed code
- [ ] Documentation updated
- [ ] Tests added
- [ ] Ready for review

## Mentorship Notes
This PR was created through the Tamma autonomous mentorship system.
";
    }
}
```

---

### **Phase 3: Workflow Implementation (Week 5-6)**

**Goal**: Create the complete ELSA workflow implementing our UML state machine

#### 3.1 Main Mentorship Workflow

```json
{
  "id": "tamma-autonomous-mentorship",
  "name": "Tamma Autonomous Mentorship",
  "description": "Complete autonomous mentorship workflow for junior developers",
  "version": "1.0.0",
  "variables": [
    {
      "name": "storyId",
      "type": "string",
      "defaultValue": ""
    },
    {
      "name": "juniorId",
      "type": "string",
      "defaultValue": ""
    },
    {
      "name": "sessionId",
      "type": "string",
      "defaultValue": ""
    },
    {
      "name": "currentState",
      "type": "string",
      "defaultValue": "INIT_STORY_PROCESSING"
    },
    {
      "name": "assessmentResult",
      "type": "object",
      "defaultValue": null
    },
    {
      "name": "progressStatus",
      "type": "object",
      "defaultValue": null
    },
    {
      "name": "qualityResult",
      "type": "object",
      "defaultValue": null
    },
    {
      "name": "reviewStatus",
      "type": "object",
      "defaultValue": null
    }
  ],
  "activities": [
    {
      "id": "1",
      "type": "WriteLine",
      "displayName": "Initialize Mentorship",
      "expressions": {
        "text": "\"🚀 Tamma: Starting mentorship for story \" + storyId + \" and junior \" + juniorId"
      }
    },
    {
      "id": "2",
      "type": "SetVariable",
      "displayName": "Set Initial State",
      "expressions": {
        "variableName": "currentState",
        "value": "\"INIT_STORY_PROCESSING\""
      }
    },
    {
      "id": "3",
      "type": "AssessJuniorCapability",
      "displayName": "Assess Junior Understanding",
      "expressions": {
        "storyId": "storyId",
        "juniorId": "juniorId",
        "sessionId": "sessionId"
      },
      "outputs": {
        "result": "assessmentResult",
        "nextState": "nextState"
      }
    },
    {
      "id": "4",
      "type": "FlowDecision",
      "displayName": "Process Assessment Result",
      "expressions": {
        "condition": "assessmentResult.Status"
      },
      "branches": [
        {
          "name": "Correct Understanding",
          "condition": "assessmentResult.Status == \"Correct\"",
          "activities": [
            {
              "id": "4a",
              "type": "WriteLine",
              "expressions": {
                "text": "\"✅ Junior understands requirements, moving to planning\""
              }
            },
            {
              "id": "4b",
              "type": "SetVariable",
              "expressions": {
                "variableName": "currentState",
                "value": "\"PLAN_DECOMPOSITION\""
              }
            }
          ]
        },
        {
          "name": "Partial Understanding",
          "condition": "assessmentResult.Status == \"Partial\"",
          "activities": [
            {
              "id": "4c",
              "type": "WriteLine",
              "expressions": {
                "text": "\"⚠️ Junior has partial understanding, providing clarification\""
              }
            },
            {
              "id": "4d",
              "type": "SetVariable",
              "expressions": {
                "variableName": "currentState",
                "value": "\"CLARIFY_REQUIREMENTS\""
              }
            }
          ]
        },
        {
          "name": "Misunderstanding",
          "condition": "assessmentResult.Status == \"Incorrect\"",
          "activities": [
            {
              "id": "4e",
              "type": "WriteLine",
              "expressions": {
                "text": "\"❌ Junior misunderstood, re-explaining story\""
              }
            },
            {
              "id": "4f",
              "type": "SetVariable",
              "expressions": {
                "variableName": "currentState",
                "value": "\"RE_EXPLAIN_STORY\""
              }
            }
          ]
        },
        {
          "name": "Timeout",
          "condition": "assessmentResult.Status == \"Timeout\"",
          "activities": [
            {
              "id": "4g",
              "type": "WriteLine",
              "expressions": {
                "text": "\"⏰ Assessment timeout, diagnosing blocker\""
              }
            },
            {
              "id": "4h",
              "type": "SetVariable",
              "expressions": {
                "variableName": "currentState",
                "value": "\"DIAGNOSE_BLOCKER\""
              }
            }
          ]
        }
      ]
    },
    {
      "id": "5",
      "type": "MonitorImplementation",
      "displayName": "Monitor Implementation Progress",
      "expressions": {
        "sessionId": "sessionId",
        "storyId": "storyId",
        "juniorId": "juniorId"
      },
      "outputs": {
        "status": "progressStatus",
        "nextState": "nextState"
      }
    },
    {
      "id": "6",
      "type": "FlowDecision",
      "displayName": "Process Progress Status",
      "expressions": {
        "condition": "progressStatus.Status"
      },
      "branches": [
        {
          "name": "Implementation Complete",
          "condition": "progressStatus.Status == \"COMPLETE\"",
          "activities": [
            {
              "id": "6a",
              "type": "WriteLine",
              "expressions": {
                "text": "\"✅ Implementation complete, running quality gates\""
              }
            },
            {
              "id": "6b",
              "type": "SetVariable",
              "expressions": {
                "variableName": "currentState",
                "value": "\"QUALITY_GATE_CHECK\""
              }
            }
          ]
        },
        {
          "name": "Progress Stalled",
          "condition": "progressStatus.Status == \"STALLED\"",
          "activities": [
            {
              "id": "6c",
              "type": "WriteLine",
              "expressions": {
                "text": "\"⚠️ Progress stalled: \" + progressStatus.Reason"
              }
            },
            {
              "id": "6d",
              "type": "SetVariable",
              "expressions": {
                "variableName": "currentState",
                "value": "\"DIAGNOSE_BLOCKER\""
              }
            }
          ]
        },
        {
          "name": "Circular Behavior",
          "condition": "progressStatus.Status == \"CIRCULAR\"",
          "activities": [
            {
              "id": "6e",
              "type": "WriteLine",
              "expressions": {
                "text": "\"🔄 Circular behavior detected: \" + progressStatus.Pattern"
              }
            },
            {
              "id": "6f",
              "type": "SetVariable",
              "expressions": {
                "variableName": "currentState",
                "value": "\"DETECT_PATTERN\""
              }
            }
          ]
        }
      ]
    },
    {
      "id": "7",
      "type": "QualityGateCheck",
      "displayName": "Run Quality Gate Checks",
      "expressions": {
        "sessionId": "sessionId",
        "storyId": "storyId"
      },
      "outputs": {
        "result": "qualityResult",
        "nextState": "nextState"
      }
    },
    {
      "id": "8",
      "type": "FlowDecision",
      "displayName": "Process Quality Gates",
      "expressions": {
        "condition": "qualityResult.Passed"
      },
      "branches": [
        {
          "name": "Quality Gates Passed",
          "condition": "qualityResult.Passed == true",
          "activities": [
            {
              "id": "8a",
              "type": "WriteLine",
              "expressions": {
                "text": "\"✅ All quality gates passed, preparing code review\""
              }
            },
            {
              "id": "8b",
              "type": "SetVariable",
              "expressions": {
                "variableName": "currentState",
                "value": "\"PREPARE_CODE_REVIEW\""
              }
            }
          ]
        },
        {
          "name": "Quality Issues Found",
          "condition": "qualityResult.Passed == false",
          "activities": [
            {
              "id": "8c",
              "type": "WriteLine",
              "expressions": {
                "text": "\"⚠️ Quality issues found: \" + qualityResult.Issues.Length + \" issues\""
              }
            },
            {
              "id": "8d",
              "type": "AutoFixIssues",
              "expressions": {
                "issues": "qualityResult.Issues"
              }
            },
            {
              "id": "8e",
              "type": "SetVariable",
              "expressions": {
                "variableName": "currentState",
                "value": "\"AUTO_FIX_ISSUES\""
              }
            }
          ]
        }
      ]
    },
    {
      "id": "9",
      "type": "PrepareCodeReview",
      "displayName": "Prepare Code Review",
      "expressions": {
        "sessionId": "sessionId",
        "storyId": "storyId"
      }
    },
    {
      "id": "10",
      "type": "MonitorCodeReview",
      "displayName": "Monitor Code Review",
      "expressions": {
        "sessionId": "sessionId"
      },
      "outputs": {
        "status": "reviewStatus",
        "nextState": "nextState"
      }
    },
    {
      "id": "11",
      "type": "FlowDecision",
      "displayName": "Process Review Status",
      "expressions": {
        "condition": "reviewStatus.Status"
      },
      "branches": [
        {
          "name": "Review Approved",
          "condition": "reviewStatus.Status == \"APPROVED\"",
          "activities": [
            {
              "id": "11a",
              "type": "WriteLine",
              "expressions": {
                "text": "\"✅ Code review approved, merging and completing\""
              }
            },
            {
              "id": "11b",
              "type": "MergeAndComplete",
              "expressions": {
                "sessionId": "sessionId",
                "storyId": "storyId"
              }
            },
            {
              "id": "11c",
              "type": "WriteLine",
              "expressions": {
                "text": "\"🎉 Tamma mentorship completed successfully!\""
              }
            }
          ]
        },
        {
          "name": "Changes Required",
          "condition": "reviewStatus.Status == \"CHANGES_REQUIRED\"",
          "activities": [
            {
              "id": "11d",
              "type": "WriteLine",
              "expressions": {
                "text": "\"📝 Review changes required, guiding fixes\""
              }
            },
            {
              "id": "11e",
              "type": "GuideFixes",
              "expressions": {
                "sessionId": "sessionId",
                "changes": "reviewStatus.Changes"
              }
            },
            {
              "id": "11f",
              "type": "SetVariable",
              "expressions": {
                "variableName": "currentState",
                "value": "\"GUIDE_FIXES\""
              }
            }
          ]
        }
      ]
    }
  ],
  "connections": [
    {
      "source": "1",
      "target": "2",
      "outcome": "Done"
    },
    {
      "source": "2",
      "target": "3",
      "outcome": "Done"
    },
    {
      "source": "3",
      "target": "4",
      "outcome": "Done"
    },
    {
      "source": "4",
      "target": "5",
      "outcome": "Correct Understanding"
    },
    {
      "source": "4",
      "target": "3",
      "outcome": "Partial Understanding"
    },
    {
      "source": "4",
      "target": "3",
      "outcome": "Misunderstanding"
    },
    {
      "source": "4",
      "target": "7",
      "outcome": "Timeout"
    },
    {
      "source": "5",
      "target": "6",
      "outcome": "Done"
    },
    {
      "source": "6",
      "target": "7",
      "outcome": "Implementation Complete"
    },
    {
      "source": "6",
      "target": "7",
      "outcome": "Progress Stalled"
    },
    {
      "source": "6",
      "target": "7",
      "outcome": "Circular Behavior"
    },
    {
      "source": "7",
      "target": "8",
      "outcome": "Done"
    },
    {
      "source": "8",
      "target": "9",
      "outcome": "Quality Gates Passed"
    },
    {
      "source": "8",
      "target": "7",
      "outcome": "Quality Issues Found"
    },
    {
      "source": "9",
      "target": "10",
      "outcome": "Done"
    },
    {
      "source": "10",
      "target": "11",
      "outcome": "Done"
    },
    {
      "source": "11",
      "target": "5",
      "outcome": "Changes Required"
    }
  ]
}
```

---

### **Phase 4: API and Dashboard (Week 7-8)**

**Goal**: Build the API layer and React dashboard for monitoring

#### 4.1 API Implementation

**MentorshipController.cs**

```csharp
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class MentorshipController : ControllerBase
{
    private readonly IElsaWorkflowService _elsaService;
    private readonly IMentorshipService _mentorshipService;
    private readonly ILogger<MentorshipController> _logger;

    [HttpPost("start")]
    public async Task<ActionResult<MentorshipStartResponse>> StartMentorship(
        [FromBody] StartMentorshipRequest request)
    {
        try
        {
            // Validate request
            if (string.IsNullOrEmpty(request.StoryId) || string.IsNullOrEmpty(request.JuniorId))
            {
                return BadRequest("Story ID and Junior ID are required");
            }

            // Create mentorship session
            var session = await _mentorshipService.CreateSessionAsync(request.StoryId, request.JuniorId);

            // Start ELSA workflow
            var workflowInput = new Dictionary<string, object>
            {
                ["storyId"] = request.StoryId,
                ["juniorId"] = request.JuniorId,
                ["sessionId"] = session.Id
            };

            var workflowInstance = await _elsaService.StartWorkflowAsync(
                "tamma-autonomous-mentorship",
                workflowInput);

            // Update session with workflow instance ID
            await _mentorshipService.UpdateSessionWorkflowAsync(session.Id, workflowInstance.Id);

            _logger.LogInformation("Started mentorship session {SessionId} for story {StoryId} and junior {JuniorId}",
                session.Id, request.StoryId, request.JuniorId);

            return Ok(new MentorshipStartResponse
            {
                SessionId = session.Id,
                WorkflowInstanceId = workflowInstance.Id,
                Status = "started",
                CurrentState = "INIT_STORY_PROCESSING"
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to start mentorship session");
            return StatusCode(500, "Failed to start mentorship session");
        }
    }

    [HttpGet("sessions/{sessionId}")]
    public async Task<ActionResult<MentorshipSessionDetails>> GetSession(string sessionId)
    {
        var session = await _mentorshipService.GetSessionWithDetailsAsync(sessionId);
        if (session == null)
            return NotFound();

        return Ok(session);
    }

    [HttpGet("sessions")]
    public async Task<ActionResult<PagedResult<MentorshipSessionSummary>>> GetSessions(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        [FromQuery] string juniorId = null,
        [FromQuery] string status = null)
    {
        var result = await _mentorshipService.GetSessionsAsync(page, pageSize, juniorId, status);
        return Ok(result);
    }

    [HttpPost("sessions/{sessionId}/pause")]
    public async Task<ActionResult> PauseSession(string sessionId)
    {
        await _mentorshipService.PauseSessionAsync(sessionId);
        await _elsaService.PauseWorkflowAsync(sessionId);
        return Ok();
    }

    [HttpPost("sessions/{sessionId}/resume")]
    public async Task<ActionResult> ResumeSession(string sessionId)
    {
        await _mentorshipService.ResumeSessionAsync(sessionId);
        await _elsaService.ResumeWorkflowAsync(sessionId);
        return Ok();
    }

    [HttpPost("sessions/{sessionId}/cancel")]
    public async Task<ActionResult> CancelSession(string sessionId)
    {
        await _mentorshipService.CancelSessionAsync(sessionId);
        await _elsaService.CancelWorkflowAsync(sessionId);
        return Ok();
    }

    [HttpGet("sessions/{sessionId}/events")]
    public async Task<ActionResult<List<MentorshipEvent>>> GetSessionEvents(string sessionId)
    {
        var events = await _mentorshipService.GetSessionEventsAsync(sessionId);
        return Ok(events);
    }

    [HttpGet("analytics/dashboard")]
    public async Task<ActionResult<DashboardAnalytics>> GetDashboardAnalytics()
    {
        var analytics = await _mentorshipService.GetDashboardAnalyticsAsync();
        return Ok(analytics);
    }
}
```

#### 4.2 React Dashboard Components

**MentorshipFlow.tsx**

```typescript
import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MentorshipSession, MentorshipState } from '@/types/mentorship';
import { tammaApi } from '@/services/tammaApi';

interface MentorshipFlowProps {
  sessionId: string;
}

export const MentorshipFlow: React.FC<MentorshipFlowProps> = ({ sessionId }) => {
  const [session, setSession] = useState<MentorshipSession | null>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadSession = async () => {
      try {
        const [sessionData, eventsData] = await Promise.all([
          tammaApi.getSession(sessionId),
          tammaApi.getSessionEvents(sessionId)
        ]);

        setSession(sessionData);
        setEvents(eventsData);
      } catch (error) {
        console.error('Failed to load session:', error);
      } finally {
        setLoading(false);
      }
    };

    loadSession();

    // Set up real-time updates
    const eventSource = new EventSource(`/api/sessions/${sessionId}/events/stream`);
    eventSource.onmessage = (event) => {
      const newEvent = JSON.parse(event.data);
      setEvents(prev => [...prev, newEvent]);
      if (newEvent.type === 'state_change') {
        setSession(prev => prev ? { ...prev, currentState: newEvent.data.newState } : null);
      }
    };

    return () => eventSource.close();
  }, [sessionId]);

  const getStateColor = (state: string) => {
    const colors: Record<string, string> = {
      'INIT_STORY_PROCESSING': 'bg-blue-500',
      'ASSESS_JUNIOR_CAPABILITY': 'bg-yellow-500',
      'PLAN_DECOMPOSITION': 'bg-purple-500',
      'START_IMPLEMENTATION': 'bg-green-500',
      'MONITOR_PROGRESS': 'bg-orange-500',
      'QUALITY_GATE_CHECK': 'bg-red-500',
      'PREPARE_CODE_REVIEW': 'bg-indigo-500',
      'MONITOR_REVIEW': 'bg-pink-500',
      'MERGE_AND_COMPLETE': 'bg-emerald-500'
    };
    return colors[state] || 'bg-gray-500';
  };

  const formatDuration = (start: string, end?: string) => {
    const startTime = new Date(start);
    const endTime = end ? new Date(end) : new Date();
    const duration = endTime.getTime() - startTime.getTime();
    const hours = Math.floor(duration / (1000 * 60 * 60));
    const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  if (loading) {
    return <div className="flex justify-center items-center h-64">Loading...</div>;
  }

  if (!session) {
    return <div className="text-center text-red-500">Session not found</div>;
  }

  return (
    <div className="space-y-6">
      {/* Session Header */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <h3 className="text-lg font-semibold">Mentorship Session</h3>
            <p className="text-sm text-muted-foreground">
              Story: {session.storyId} | Junior: {session.juniorId}
            </p>
          </div>
          <div className="flex space-x-2">
            <Badge className={getStateColor(session.currentState)}>
              {session.currentState.replace(/_/g, ' ')}
            </Badge>
            <Badge variant={session.status === 'active' ? 'default' : 'secondary'}>
              {session.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Duration</p>
              <p className="text-lg font-semibold">
                {formatDuration(session.createdAt, session.completedAt)}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Events</p>
              <p className="text-lg font-semibold">{events.length}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* State Flow Visualization */}
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">State Flow</h3>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col space-y-4">
            {events
              .filter(event => event.type === 'state_change')
              .map((event, index) => (
                <div key={index} className="flex items-center space-x-4">
                  <div className={`w-4 h-4 rounded-full ${getStateColor(event.data.oldState)}`} />
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">
                        {event.data.oldState.replace(/_/g, ' ')}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {new Date(event.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                    {event.data.reason && (
                      <p className="text-sm text-muted-foreground mt-1">
                        {event.data.reason}
                      </p>
                    )}
                  </div>
                  <div className={`w-4 h-4 rounded-full ${getStateColor(event.data.newState)}`} />
                </div>
              ))}
          </div>
        </CardContent>
      </Card>

      {/* Recent Events */}
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">Recent Events</h3>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {events.slice(-10).reverse().map((event, index) => (
              <div key={index} className="flex items-start space-x-3 p-3 rounded-lg bg-muted/50">
                <div className={`w-2 h-2 rounded-full mt-2 ${
                  event.type === 'state_change' ? 'bg-blue-500' :
                  event.type === 'error' ? 'bg-red-500' :
                  event.type === 'warning' ? 'bg-yellow-500' : 'bg-gray-500'
                }`} />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium capitalize">
                      {event.type.replace(/_/g, ' ')}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {new Date(event.createdAt).toLocaleString()}
                    </span>
                  </div>
                  {event.data && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {typeof event.data === 'string'
                        ? event.data
                        : JSON.stringify(event.data, null, 2)
                      }
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Control Buttons */}
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">Session Controls</h3>
        </CardHeader>
        <CardContent>
          <div className="flex space-x-2">
            {session.status === 'active' && (
              <Button
                variant="outline"
                onClick={() => tammaApi.pauseSession(sessionId)}
              >
                Pause
              </Button>
            )}
            {session.status === 'paused' && (
              <Button
                onClick={() => tammaApi.resumeSession(sessionId)}
              >
                Resume
              </Button>
            )}
            <Button
              variant="destructive"
              onClick={() => tammaApi.cancelSession(sessionId)}
            >
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
```

---

### **Phase 5: Testing & Deployment (Week 9-10)**

**Goal**: Comprehensive testing and production deployment

#### 5.1 Testing Strategy

**Unit Tests**

```csharp
// Tests/Tamma.Activities.Tests/AssessJuniorCapabilityActivityTests.cs
[TestFixture]
public class AssessJuniorCapabilityActivityTests
{
    private AssessJuniorCapabilityActivity _activity;
    private Mock<ICommunicationService> _mockCommunication;
    private Mock<IAIAnalysisService> _mockAiService;
    private Mock<IMentorshipRepository> _mockRepository;

    [SetUp]
    public void SetUp()
    {
        _mockCommunication = new Mock<ICommunicationService>();
        _mockAiService = new Mock<IAIAnalysisService>();
        _mockRepository = new Mock<IMentorshipRepository>();

        _activity = new AssessJuniorCapabilityActivity(
            _mockCommunication.Object,
            _mockAiService.Object,
            _mockRepository.Object);
    }

    [Test]
    public async Task OnExecute_WithCorrectUnderstanding_ReturnsCorrectOutcome()
    {
        // Arrange
        var storyId = "story-123";
        var juniorId = "junior-456";
        var sessionId = "session-789";

        var story = new Story { Id = storyId, Title = "Test Story", Complexity = 3 };
        var junior = new JuniorDeveloper { Id = juniorId, Name = "Test Junior" };

        _mockRepository.Setup(r => r.GetStoryAsync(storyId)).ReturnsAsync(story);
        _mockRepository.Setup(r => r.GetJuniorAsync(juniorId)).ReturnsAsync(junior);

        var response = new JuniorResponse
        {
            StoryId = storyId,
            JuniorId = juniorId,
            Answers = new[]
            {
                "I understand we need to build a user authentication API",
                "Main challenge will be JWT token management",
                "I'll use Node.js with Express and jsonwebtoken library"
            }
        };

        _mockCommunication.Setup(c => c.WaitForResponseAsync(juniorId, storyId))
            .ReturnsAsync(response);

        var assessmentResult = new AssessmentResult
        {
            Status = AssessmentStatus.Correct,
            Confidence = 0.9,
            NextState = MentorshipState.PLAN_DECOMPOSITION
        };

        _mockAiService.Setup(a => a.AnalyzeAssessmentResponseAsync(response, story))
            .ReturnsAsync(assessmentResult);

        // Act
        var context = new ActivityExecutionContext
        {
            Input = new Dictionary<string, object>
            {
                ["StoryId"] = storyId,
                ["JuniorId"] = juniorId,
                ["SessionId"] = sessionId
            }
        };

        var result = await _activity.OnExecuteAsync(context);

        // Assert
        Assert.That(result.Outcome, Is.EqualTo("Correct"));
        Assert.That(result.Outputs["Result"], Is.EqualTo(assessmentResult));
        Assert.That(result.Outputs["NextState"], Is.EqualTo("PLAN_DECOMPOSITION"));

        _mockRepository.Verify(r => r.UpdateSessionStateAsync(sessionId, MentorshipState.ASSESS_JUNIOR_CAPABILITY), Times.Once);
        _mockCommunication.Verify(c => c.SendAssessmentAsync(It.IsAny<AssessmentRequest>()), Times.Once);
    }

    [Test]
    public async Task OnExecute_WithTimeout_ReturnsTimeoutOutcome()
    {
        // Arrange
        var storyId = "story-123";
        var juniorId = "junior-456";
        var sessionId = "session-789";

        var story = new Story { Id = storyId, Title = "Test Story", Complexity = 3 };
        var junior = new JuniorDeveloper { Id = juniorId, Name = "Test Junior" };

        _mockRepository.Setup(r => r.GetStoryAsync(storyId)).ReturnsAsync(story);
        _mockRepository.Setup(r => r.GetJuniorAsync(juniorId)).ReturnsAsync(junior);

        _mockCommunication.Setup(c => c.WaitForResponseAsync(juniorId, storyId))
            .ReturnsAsync((JuniorResponse)null); // No response

        // Act
        var context = new ActivityExecutionContext
        {
            Input = new Dictionary<string, object>
            {
                ["StoryId"] = storyId,
                ["JuniorId"] = juniorId,
                ["SessionId"] = sessionId
            }
        };

        var result = await _activity.OnExecuteAsync(context);

        // Assert
        Assert.That(result.Outcome, Is.EqualTo("Timeout"));

        var timeoutResult = result.Outputs["Result"] as AssessmentResult;
        Assert.That(timeoutResult.Status, Is.EqualTo(AssessmentStatus.Timeout));
        Assert.That(timeoutResult.NextState, Is.EqualTo(MentorshipState.DIAGNOSE_BLOCKER));

        _mockCommunication.Verify(c => c.SendTimeoutNotificationAsync(juniorId, storyId), Times.Once);
    }
}
```

**Integration Tests**

```csharp
// Tests/Tamma.Api.Tests/MentorshipControllerTests.cs
[TestFixture]
public class MentorshipControllerTests
{
    private HttpClient _client;
    private TestServer _server;
    private Mock<IElsaWorkflowService> _mockElsaService;
    private Mock<IMentorshipService> _mockMentorshipService;

    [SetUp]
    public void SetUp()
    {
        _mockElsaService = new Mock<IElsaWorkflowService>();
        _mockMentorshipService = new Mock<IMentorshipService>();

        _server = new TestServer(new WebHostBuilder()
            .ConfigureServices(services =>
            {
                services.AddSingleton(_mockElsaService.Object);
                services.AddSingleton(_mockMentorshipService.Object);
                services.AddControllers();
            })
            .Configure(app =>
            {
                app.UseRouting();
                app.UseEndpoints(endpoints => endpoints.MapControllers());
            }));

        _client = _server.CreateClient();
    }

    [Test]
    public async Task StartMentorship_WithValidRequest_ReturnsSuccessResponse()
    {
        // Arrange
        var request = new StartMentorshipRequest
        {
            StoryId = "story-123",
            JuniorId = "junior-456"
        };

        var session = new MentorshipSession
        {
            Id = "session-789",
            StoryId = request.StoryId,
            JuniorId = request.JuniorId,
            CurrentState = "INIT_STORY_PROCESSING",
            Status = "active"
        };

        var workflowInstance = new WorkflowInstance
        {
            Id = "workflow-instance-123",
            WorkflowId = "tamma-autonomous-mentorship"
        };

        _mockMentorshipService.Setup(s => s.CreateSessionAsync(request.StoryId, request.JuniorId))
            .ReturnsAsync(session);

        _mockElsaService.Setup(s => s.StartWorkflowAsync("tamma-autonomous-mentorship",
            It.IsAny<Dictionary<string, object>>()))
            .ReturnsAsync(workflowInstance);

        // Act
        var response = await _client.PostAsJsonAsync("/api/mentorship/start", request);

        // Assert
        response.EnsureSuccessStatusCode();

        var result = await response.Content.ReadFromJsonAsync<MentorshipStartResponse>();

        Assert.That(result.SessionId, Is.EqualTo(session.Id));
        Assert.That(result.WorkflowInstanceId, Is.EqualTo(workflowInstance.Id));
        Assert.That(result.Status, Is.EqualTo("started"));
        Assert.That(result.CurrentState, Is.EqualTo("INIT_STORY_PROCESSING"));

        _mockMentorshipService.Verify(s => s.CreateSessionAsync(request.StoryId, request.JuniorId), Times.Once);
        _mockElsaService.Verify(s => s.StartWorkflowAsync("tamma-autonomous-mentorship",
            It.Is<Dictionary<string, object>>(d =>
                d["storyId"].ToString() == request.StoryId &&
                d["juniorId"].ToString() == request.JuniorId)), Times.Once);
    }
}
```

#### 5.2 Production Deployment

**Kubernetes Deployment**

```yaml
# k8s/tamma-deployment.yml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: tamma-engine
  labels:
    app: tamma-engine
spec:
  replicas: 3
  selector:
    matchLabels:
      app: tamma-engine
  template:
    metadata:
      labels:
        app: tamma-engine
    spec:
      containers:
        - name: elsa-server
          image: your-registry/tamma-elsa:latest
          ports:
            - containerPort: 5000
          env:
            - name: ConnectionStrings__DefaultConnection
              valueFrom:
                secretKeyRef:
                  name: tamma-secrets
                  key: database-connection
            - name: RabbitMq__HostName
              value: rabbitmq-service
          resources:
            requests:
              memory: '512Mi'
              cpu: '250m'
            limits:
              memory: '1Gi'
              cpu: '500m'
          livenessProbe:
            httpGet:
              path: /health
              port: 5000
            initialDelaySeconds: 30
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /health
              port: 5000
            initialDelaySeconds: 5
            periodSeconds: 5

        - name: tamma-api
          image: your-registry/tamma-api:latest
          ports:
            - containerPort: 3000
          env:
            - name: ELSA_SERVER_URL
              value: http://elsa-server:5000
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: tamma-secrets
                  key: database-connection
            - name: SLACK_WEBHOOK
              valueFrom:
                secretKeyRef:
                  name: tamma-secrets
                  key: slack-webhook
            - name: GITHUB_TOKEN
              valueFrom:
                secretKeyRef:
                  name: tamma-secrets
                  key: github-token
          resources:
            requests:
              memory: '256Mi'
              cpu: '100m'
            limits:
              memory: '512Mi'
              cpu: '250m'

---
apiVersion: v1
kind: Service
metadata:
  name: tamma-api-service
spec:
  selector:
    app: tamma-engine
  ports:
    - protocol: TCP
      port: 80
      targetPort: 3000
  type: LoadBalancer

---
apiVersion: v1
kind: Service
metadata:
  name: elsa-server-service
spec:
  selector:
    app: tamma-engine
  ports:
    - protocol: TCP
      port: 5000
      targetPort: 5000
  type: ClusterIP
```

---

## 📅 Implementation Timeline

| Week | Phase                   | Key Deliverables                                          |
| ---- | ----------------------- | --------------------------------------------------------- |
| 1-2  | Foundation Setup        | ELSA deployed, database schema, project structure         |
| 3-4  | Core Activities         | All mentorship activities implemented and tested          |
| 5-6  | Workflow Implementation | Complete state machine in ELSA, all transitions working   |
| 7-8  | API & Dashboard         | REST API, React dashboard, real-time monitoring           |
| 9-10 | Testing & Deployment    | Comprehensive tests, production deployment, documentation |

## 🎯 Success Criteria

### **Technical Success**

- ✅ All 20+ states implemented and working
- ✅ Real-time monitoring dashboard functional
- ✅ Integration with GitHub, Slack, email working
- ✅ AI-powered analysis and guidance operational
- ✅ Production deployment stable and scalable

### **Business Success**

- ✅ Reduced mentorship overhead by 80%
- ✅ Improved junior developer productivity by 40%
- ✅ Consistent quality standards across all implementations
- ✅ Real-time visibility into mentorship progress
- ✅ Data-driven insights for process improvement

## 🚀 Next Steps After Implementation

1. **AI Enhancement**: Integrate advanced AI for personalized mentorship
2. **Analytics Expansion**: Add predictive analytics and trend analysis
3. **Mobile App**: Create mobile interface for junior developers
4. **Enterprise Features**: Add SSO, audit logs, compliance reporting
5. **Ecosystem Integration**: Connect with more development tools and platforms

This comprehensive plan provides a clear roadmap to build the Tamma engine using ELSA, implementing the complete autonomous mentorship state machine we designed in our UML diagram.
