# Autonomous Mentorship - ELSA Workflows Setup

## Quick Start (10 minutes)

### 1. Docker Compose Setup

```yaml
# docker-compose.yml
version: '3.8'
services:
  elsa-server:
    image: elsaworkflows/elsa-core:latest
    ports:
      - '5000:5000'
    environment:
      - ConnectionStrings__DefaultConnection=Server=postgres;Database=elsa;User Id=elsa;Password=elsa123;
      - RabbitMq__HostName=rabbitmq
      - RabbitMq__Username=guest
      - RabbitMq__Password=guest
      - Logging__LogLevel__Default=Information
    depends_on:
      - postgres
      - rabbitmq
    volumes:
      - ./workflows:/app/workflows

  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: elsa
      POSTGRES_USER: elsa
      POSTGRES_PASSWORD: elsa123
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
      RABBITMQ_DEFAULT_USER: guest
      RABBITMQ_DEFAULT_PASS: guest
    volumes:
      - rabbitmq_data:/var/lib/rabbitmq

volumes:
  postgres_data:
  rabbitmq_data:
```

### 2. Start ELSA

```bash
docker-compose up -d
# Wait for startup (30 seconds)
curl http://localhost:5000/health
```

### 3. Access ELSA Studio

```
http://localhost:5000
```

## Mentorship Workflow Implementation

### 1. Create Mentorship Activities

#### Custom Activity for Junior Assessment

```csharp
// Activities/AssessJuniorCapabilityActivity.cs
using Elsa.ActivityResults;
using Elsa.Attributes;
using Elsa.Services;
using Elsa.Expressions;
using System.Threading.Tasks;

[Activity(
    DisplayName = "Assess Junior Capability",
    Category = "Mentorship",
    Description = "Evaluate junior developer's understanding of story requirements"
)]
public class AssessJuniorCapabilityActivity : Activity
{
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

    [ActivityOutput(
        Label = "Assessment Result",
        Description = "Result of the capability assessment"
    )]
    public AssessmentResult Result { get; set; }

    protected override IActivityExecutionResult OnExecute()
    {
        // Send assessment questions to junior
        var assessment = new AssessmentRequest
        {
            StoryId = StoryId,
            JuniorId = JuniorId,
            Questions = new[]
            {
                "What do you understand needs to be built?",
                "What technical challenges do you foresee?",
                "What's your planned approach?"
            },
            Timeout = TimeSpan.FromMinutes(5)
        };

        // Send via Slack/Email/In-app
        _communicationService.SendAssessment(assessment);

        // Set timeout for response
        var timeoutTask = Task.Delay(assessment.Timeout);
        var responseTask = _communicationService.WaitForResponseAsync(JuniorId, StoryId);

        var completedTask = Task.WhenAny(timeoutTask, responseTask).Result;

        if (completedTask == timeoutTask)
        {
            Result = new AssessmentResult
            {
                Status = AssessmentStatus.Timeout,
                NextState = "DIAGNOSE_BLOCKER"
            };
        }
        else
        {
            var response = responseTask.Result;
            Result = AnalyzeResponse(response);
        }

        return Done();
    }

    private AssessmentResult AnalyzeResponse(JuniorResponse response)
    {
        // AI-powered analysis of junior's understanding
        var analysis = _aiService.AnalyzeUnderstanding(response);

        return new AssessmentResult
        {
            Status = analysis.UnderstandingLevel switch
            {
                UnderstandingLevel.Correct => AssessmentStatus.Correct,
                UnderstandingLevel.Partial => AssessmentStatus.Partial,
                UnderstandingLevel.Incorrect => AssessmentStatus.Incorrect,
                _ => AssessmentStatus.Unclear
            },
            Confidence = analysis.Confidence,
            Gaps = analysis.IdentifiedGaps,
            NextState = analysis.UnderstandingLevel switch
            {
                UnderstandingLevel.Correct => "PLAN_DECOMPOSITION",
                UnderstandingLevel.Partial => "CLARIFY_REQUIREMENTS",
                UnderstandingLevel.Incorrect => "RE_EXPLAIN_STORY",
                _ => "DIAGNOSE_BLOCKER"
            }
        };
    }
}

public class AssessmentResult
{
    public AssessmentStatus Status { get; set; }
    public double Confidence { get; set; }
    public string[] Gaps { get; set; }
    public string NextState { get; set; }
}

public enum AssessmentStatus
{
    Correct,
    Partial,
    Incorrect,
    Timeout,
    Unclear
}
```

#### Activity for Implementation Monitoring

```csharp
// Activities/MonitorImplementationActivity.cs
[Activity(
    DisplayName = "Monitor Implementation Progress",
    Category = "Mentorship",
    Description = "Monitor junior developer's implementation progress"
)]
public class MonitorImplementationActivity : Activity
{
    [ActivityInput(Label = "Session ID")]
    public string SessionId { get; set; }

    [ActivityInput(Label = "Story ID")]
    public string StoryId { get; set; }

    [ActivityInput(Label = "Junior ID")]
    public string JuniorId { get; set; }

    [ActivityOutput(Label = "Progress Status")]
    public ProgressStatus Status { get; set; }

    protected override async Task<IActivityExecutionResult> OnExecuteAsync()
    {
        var monitoring = new ImplementationMonitoring
        {
            SessionId = SessionId,
            StoryId = StoryId,
            JuniorId = JuniorId,
            CheckInterval = TimeSpan.FromMinutes(5),
            MaxStallTime = TimeSpan.FromMinutes(15)
        };

        var progressTracker = new ProgressTracker(monitoring);

        while (true)
        {
            var progress = await progressTracker.CheckProgressAsync();

            // Analyze progress patterns
            var analysis = AnalyzeProgress(progress);

            switch (analysis.Status)
            {
                case ProgressAnalysisStatus.Steady:
                    await Task.Delay(monitoring.CheckInterval);
                    continue;

                case ProgressAnalysisStatus.Slowing:
                    await SendEncouragement(JuniorId, analysis.Reason);
                    await Task.Delay(monitoring.CheckInterval);
                    continue;

                case ProgressAnalysisStatus.Stalled:
                    Status = new ProgressStatus
                    {
                        Status = "STALLED",
                        Reason = analysis.Reason,
                        NextState = "DIAGNOSE_BLOCKER"
                    };
                    return Done();

                case ProgressAnalysisStatus.Circular:
                    Status = new ProgressStatus
                    {
                        Status = "CIRCULAR",
                        Pattern = analysis.DetectedPattern,
                        NextState = "DETECT_PATTERN"
                    };
                    return Done();

                case ProgressAnalysisStatus.Complete:
                    Status = new ProgressStatus
                    {
                        Status = "COMPLETE",
                        NextState = "QUALITY_GATE_CHECK"
                    };
                    return Done();
            }
        }
    }

    private ProgressAnalysis AnalyzeProgress(ImplementationProgress progress)
    {
        var analysis = new ProgressAnalysis();

        // Check for activity
        if (progress.LastActivity > TimeSpan.FromMinutes(10))
        {
            analysis.Status = ProgressAnalysisStatus.Stalled;
            analysis.Reason = "No activity for 10+ minutes";
            return analysis;
        }

        // Check for circular behavior
        if (IsCircularBehavior(progress))
        {
            analysis.Status = ProgressAnalysisStatus.Circular;
            analysis.DetectedPattern = IdentifyCircularPattern(progress);
            return analysis;
        }

        // Check progress rate
        var progressRate = CalculateProgressRate(progress);
        if (progressRate < 0.1) // Less than 10% progress per hour
        {
            analysis.Status = ProgressAnalysisStatus.Slowing;
            analysis.Reason = "Progress rate too slow";
            return analysis;
        }

        // Check if implementation is complete
        if (progress.CompletionPercentage >= 100)
        {
            analysis.Status = ProgressAnalysisStatus.Complete;
            return analysis;
        }

        analysis.Status = ProgressAnalysisStatus.Steady;
        return analysis;
    }

    private bool IsCircularBehavior(ImplementationProgress progress)
    {
        // Detect patterns like:
        // - Same test failing repeatedly
        // - Same build error recurring
        // - Same code changes being made
        return progress.RepeatedErrors.Count > 3 ||
               progress.RepeatedChanges.Count > 5;
    }

    private string IdentifyCircularPattern(ImplementationProgress progress)
    {
        if (progress.RepeatedErrors.Any())
            return $"Same test failing: {progress.RepeatedErrors.First()}";

        if (progress.RepeatedChanges.Any())
            return $"Same code changes: {progress.RepeatedChanges.First()}";

        return "Research loop detected";
    }
}
```

### 2. Create Mentorship Workflow in ELSA Studio

#### Main Mentorship Workflow

```json
{
  "id": "autonomous-mentorship",
  "name": "Autonomous Junior Developer Mentorship",
  "description": "Complete mentorship workflow for junior developers",
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
    }
  ],
  "activities": [
    {
      "type": "WriteLine",
      "displayName": "Initialize Mentorship",
      "expressions": {
        "text": "\"🚀 Starting mentorship for story: \" + storyId + \" and junior: \" + juniorId"
      }
    },
    {
      "type": "AssessJuniorCapability",
      "displayName": "Assess Junior Understanding",
      "expressions": {
        "storyId": "storyId",
        "juniorId": "juniorId"
      },
      "outputs": {
        "result": "assessmentResult"
      }
    },
    {
      "type": "FlowDecision",
      "displayName": "Check Assessment Result",
      "expressions": {
        "condition": "assessmentResult.Status"
      },
      "branches": [
        {
          "name": "Correct Understanding",
          "condition": "assessmentResult.Status == \"Correct\"",
          "activities": [
            {
              "type": "WriteLine",
              "expressions": {
                "text": "\"✅ Junior understands requirements, moving to planning\""
              }
            },
            {
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
              "type": "WriteLine",
              "expressions": {
                "text": "\"⚠️ Junior has partial understanding, providing clarification\""
              }
            },
            {
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
              "type": "WriteLine",
              "expressions": {
                "text": "\"❌ Junior misunderstood, re-explaining story\""
              }
            },
            {
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
              "type": "WriteLine",
              "expressions": {
                "text": "\"⏰ Assessment timeout, diagnosing blocker\""
              }
            },
            {
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
      "type": "MonitorImplementation",
      "displayName": "Monitor Implementation Progress",
      "expressions": {
        "sessionId": "sessionId",
        "storyId": "storyId",
        "juniorId": "juniorId"
      },
      "outputs": {
        "status": "progressStatus"
      }
    },
    {
      "type": "FlowDecision",
      "displayName": "Check Progress Status",
      "expressions": {
        "condition": "progressStatus.Status"
      },
      "branches": [
        {
          "name": "Implementation Complete",
          "condition": "progressStatus.Status == \"COMPLETE\"",
          "activities": [
            {
              "type": "WriteLine",
              "expressions": {
                "text": "\"✅ Implementation complete, running quality gates\""
              }
            },
            {
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
              "type": "WriteLine",
              "expressions": {
                "text": "\"⚠️ Progress stalled, diagnosing blocker: \" + progressStatus.Reason"
              }
            },
            {
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
              "type": "WriteLine",
              "expressions": {
                "text": "\"🔄 Circular behavior detected: \" + progressStatus.Pattern"
              }
            },
            {
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
      "type": "RunQualityGates",
      "displayName": "Run Quality Gate Checks",
      "expressions": {
        "sessionId": "sessionId",
        "storyId": "storyId"
      },
      "outputs": {
        "result": "qualityResult"
      }
    },
    {
      "type": "FlowDecision",
      "displayName": "Check Quality Gates",
      "expressions": {
        "condition": "qualityResult.Passed"
      },
      "branches": [
        {
          "name": "Quality Gates Passed",
          "condition": "qualityResult.Passed == true",
          "activities": [
            {
              "type": "WriteLine",
              "expressions": {
                "text": "\"✅ All quality gates passed, preparing code review\""
              }
            },
            {
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
              "type": "WriteLine",
              "expressions": {
                "text": "\"⚠️ Quality issues found: \" + qualityResult.Issues.Length + \" issues\""
              }
            },
            {
              "type": "AutoFixIssues",
              "expressions": {
                "issues": "qualityResult.Issues"
              }
            },
            {
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
      "type": "PrepareCodeReview",
      "displayName": "Prepare Code Review",
      "expressions": {
        "sessionId": "sessionId",
        "storyId": "storyId"
      }
    },
    {
      "type": "MonitorCodeReview",
      "displayName": "Monitor Code Review",
      "expressions": {
        "sessionId": "sessionId"
      },
      "outputs": {
        "status": "reviewStatus"
      }
    },
    {
      "type": "FlowDecision",
      "displayName": "Check Review Status",
      "expressions": {
        "condition": "reviewStatus.Status"
      },
      "branches": [
        {
          "name": "Review Approved",
          "condition": "reviewStatus.Status == \"APPROVED\"",
          "activities": [
            {
              "type": "WriteLine",
              "expressions": {
                "text": "\"✅ Code review approved, merging and completing\""
              }
            },
            {
              "type": "MergeAndComplete",
              "expressions": {
                "sessionId": "sessionId",
                "storyId": "storyId"
              }
            },
            {
              "type": "WriteLine",
              "expressions": {
                "text": "\"🎉 Mentorship completed successfully!\""
              }
            }
          ]
        },
        {
          "name": "Changes Required",
          "condition": "reviewStatus.Status == \"CHANGES_REQUIRED\"",
          "activities": [
            {
              "type": "WriteLine",
              "expressions": {
                "text": "\"📝 Review changes required, guiding fixes\""
              }
            },
            {
              "type": "GuideFixes",
              "expressions": {
                "sessionId": "sessionId",
                "changes": "reviewStatus.Changes"
              }
            },
            {
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
      "outcome": "Correct Understanding"
    },
    {
      "source": "3",
      "target": "5",
      "outcome": "Partial Understanding"
    },
    {
      "source": "3",
      "target": "6",
      "outcome": "Misunderstanding"
    },
    {
      "source": "3",
      "target": "7",
      "outcome": "Timeout"
    }
  ]
}
```

### 3. Integration with Development Tools

#### GitHub Integration Activity

```csharp
// Activities/GitHubIntegrationActivity.cs
[Activity(
    DisplayName = "GitHub Integration",
    Category = "Integrations"
)]
public class GitHubIntegrationActivity : Activity
{
    [ActivityInput(Label = "Action")]
    public GitHubAction Action { get; set; }

    [ActivityInput(Label = "Repository")]
    public string Repository { get; set; }

    [ActivityInput(Label = "Story ID")]
    public string StoryId { get; set; }

    [ActivityInput(Label = "Junior ID")]
    public string JuniorId { get; set; }

    protected override async Task<IActivityExecutionResult> OnExecuteAsync()
    {
        var githubClient = new GitHubClient(_githubToken);

        switch (Action)
        {
            case GitHubAction.CreateBranch:
                await CreateFeatureBranch(githubClient);
                break;

            case GitHubAction.MonitorCommits:
                return await MonitorCommits(githubClient);

            case GitHubAction.CreatePullRequest:
                await CreatePullRequest(githubClient);
                break;

            case GitHubAction.MergePullRequest:
                await MergePullRequest(githubClient);
                break;
        }

        return Done();
    }

    private async Task CreateFeatureBranch(GitHubClient client)
    {
        var branchName = $"feature/{StoryId}";
        await client.Repository.CreateBranch(Repository, branchName);

        await _notificationService.SendToJunior(JuniorId,
            $"🌿 Created feature branch: {branchName}");
    }

    private async Task<IActivityExecutionResult> MonitorCommits(GitHubClient client)
    {
        var commits = await client.Repository.GetCommits(Repository,
            $"feature/{StoryId}", since: DateTime.UtcNow.AddHours(-1));

        if (commits.Any())
        {
            return Done(new { HasActivity = true, CommitCount = commits.Count });
        }

        return Done(new { HasActivity = false, CommitCount = 0 });
    }
}
```

#### Slack Integration Activity

```csharp
// Activities/SlackIntegrationActivity.cs
[Activity(
    DisplayName = "Slack Integration",
    Category = "Integrations"
)]
public class SlackIntegrationActivity : Activity
{
    [ActivityInput(Label = "Message Type")]
    public SlackMessageType MessageType { get; set; }

    [ActivityInput(Label = "Junior ID")]
    public string JuniorId { get; set; }

    [ActivityInput(Label = "Message")]
    public string Message { get; set; }

    [ActivityInput(Label = "Story ID")]
    public string StoryId { get; set; }

    protected override async Task<IActivityExecutionResult> OnExecuteAsync()
    {
        var slackClient = new SlackClient(_slackToken);

        switch (MessageType)
        {
            case SlackMessageType.Assessment:
                await SendAssessmentMessage(slackClient);
                break;

            case SlackMessageType.Guidance:
                await SendGuidanceMessage(slackClient);
                break;

            case SlackMessageType.Timeout:
                await SendTimeoutMessage(slackClient);
                break;

            case SlackMessageType.Success:
                await SendSuccessMessage(slackClient);
                break;
        }

        return Done();
    }

    private async Task SendAssessmentMessage(SlackClient client)
    {
        var blocks = new[]
        {
            new
            {
                type = "section",
                text = new
                {
                    type = "mrkdwn",
                    text = $"*📝 Story Assessment Required*\n\nStory: {StoryId}\n\nPlease answer:\n• What do you understand needs to be built?\n• What technical challenges do you foresee?\n• What's your planned approach?"
                }
            },
            new
            {
                type = "actions",
                elements = new[]
                {
                    new
                    {
                        type = "button",
                        text = new { type = "plain_text", text = "I Understand" },
                        action_id = "understand",
                        value = $"{StoryId}:correct"
                    },
                    new
                    {
                        type = "button",
                        text = new { type = "plain_text", text = "Need Help" },
                        action_id = "help",
                        value = $"{StoryId}:help"
                    }
                }
            }
        };

        await client.SendMessage($"#{JuniorId}", blocks);
    }
}
```

### 4. Start Mentorship Session

#### API Endpoint to Start Workflow

```csharp
// Controllers/MentorshipController.cs
[ApiController]
[Route("api/[controller]")]
public class MentorshipController : ControllerBase
{
    private readonly IWorkflowStarter _workflowStarter;

    [HttpPost("start")]
    public async Task<IActionResult> StartMentorship([FromBody] StartMentorshipRequest request)
    {
        var workflowInput = new Dictionary<string, object>
        {
            ["storyId"] = request.StoryId,
            ["juniorId"] = request.JuniorId,
            ["sessionId"] = Guid.NewGuid().ToString()
        };

        var workflowInstance = await _workflowStarter.StartWorkflowAsync(
            "autonomous-mentorship",
            workflowInput);

        return Ok(new
        {
            sessionId = workflowInput["sessionId"],
            workflowId = workflowInstance.Id,
            status = "started"
        });
    }
}

public class StartMentorshipRequest
{
    public string StoryId { get; set; }
    public string JuniorId { get; set; }
}
```

#### Start Session via API

```bash
curl -X POST http://localhost:5000/api/mentorship/start \
  -H "Content-Type: application/json" \
  -d '{
    "storyId": "story-123",
    "juniorId": "junior-456"
  }'
```

## Benefits of ELSA Setup

✅ **Visual Workflow Designer** - Easy to modify mentorship flows
✅ **Bookmark Persistence** - Sessions survive restarts
✅ **Custom Activities** - Perfect for mentorship-specific logic
✅ **Integration Ready** - Built-in HTTP activities for GitHub/Slack
✅ **Scalable** - Distributed runtime for multiple juniors
✅ **Self-Hostable** - Full control over data and infrastructure
✅ **MIT License** - No licensing costs

## Resource Requirements

- **CPU**: 2-4 cores
- **RAM**: 2-4GB
- **Storage**: 50GB
- **Cost**: ~$30-50/month on cloud provider

## Next Steps

1. **Deploy ELSA** using Docker Compose
2. **Create custom activities** for mentorship logic
3. **Design workflow** in ELSA Studio
4. **Integrate with development tools** (GitHub, Slack, etc.)
5. **Build monitoring dashboard** for real-time status
6. **Scale to Kubernetes** for production

ELSA provides the perfect balance of visual workflow management and programmatic extensibility for your autonomous mentorship system!
