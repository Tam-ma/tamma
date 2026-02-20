using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Moq;
using NUnit.Framework;
using Tamma.Activities.AI;
using Tamma.Data.Repositories;

namespace Tamma.Activities.Tests.AI;

[TestFixture]
public class ClaudeAnalysisActivityTests
{
    private Mock<ILogger<ClaudeAnalysisActivity>> _mockLogger = null!;
    private Mock<IMentorshipSessionRepository> _mockRepository = null!;
    private Mock<IHttpClientFactory> _mockHttpClientFactory = null!;
    private Mock<IConfiguration> _mockConfiguration = null!;

    [SetUp]
    public void SetUp()
    {
        _mockLogger = new Mock<ILogger<ClaudeAnalysisActivity>>();
        _mockRepository = new Mock<IMentorshipSessionRepository>();
        _mockHttpClientFactory = new Mock<IHttpClientFactory>();
        _mockConfiguration = new Mock<IConfiguration>();
    }

    [Test]
    public void Constructor_WithValidDependencies_ShouldNotThrow()
    {
        // Act
        Action act = () => new ClaudeAnalysisActivity(
            _mockLogger.Object,
            _mockRepository.Object,
            _mockHttpClientFactory.Object,
            _mockConfiguration.Object);

        // Assert
        act.Should().NotThrow();
    }

    [Test]
    public void AnalysisType_ShouldHaveExpectedValues()
    {
        // Assert
        Enum.GetValues<AnalysisType>().Should().HaveCount(4);
        Enum.GetValues<AnalysisType>().Should().Contain(AnalysisType.Assessment);
        Enum.GetValues<AnalysisType>().Should().Contain(AnalysisType.CodeReview);
        Enum.GetValues<AnalysisType>().Should().Contain(AnalysisType.BlockerDiagnosis);
        Enum.GetValues<AnalysisType>().Should().Contain(AnalysisType.GuidanceGeneration);
    }

    [Test]
    public void ClaudeAnalysisOutput_Assessment_ShouldContainAssessmentFields()
    {
        // Arrange
        var output = new ClaudeAnalysisOutput
        {
            Success = true,
            AnalysisType = AnalysisType.Assessment,
            Confidence = 0.85,
            AssessmentStatus = "Correct",
            Summary = "The developer shows a good grasp of the core requirements",
            Gaps = new List<string> { "Edge case handling not mentioned" },
            Strengths = new List<string> { "Clear understanding of main user flow" },
            RecommendedAction = "Proceed with minor clarifications needed"
        };

        // Assert
        output.Success.Should().BeTrue();
        output.AnalysisType.Should().Be(AnalysisType.Assessment);
        output.Confidence.Should().BeGreaterThan(0.8);
        output.AssessmentStatus.Should().Be("Correct");
        output.Gaps.Should().HaveCount(1);
        output.Strengths.Should().HaveCount(1);
    }

    [Test]
    public void ClaudeAnalysisOutput_CodeReview_ShouldContainReviewFields()
    {
        // Arrange
        var output = new ClaudeAnalysisOutput
        {
            Success = true,
            AnalysisType = AnalysisType.CodeReview,
            OverallQuality = "Acceptable",
            Score = 85,
            Confidence = 0.85,
            CodeReviewIssues = new List<CodeReviewIssue>
            {
                new CodeReviewIssue
                {
                    Severity = "Minor",
                    Location = "line 45",
                    Issue = "Variable could have a more descriptive name",
                    Suggestion = "Rename 'x' to 'userCount'"
                }
            },
            Positives = new List<string> { "Good code structure" },
            LearningOpportunities = new List<string> { "Error handling patterns" }
        };

        // Assert
        output.AnalysisType.Should().Be(AnalysisType.CodeReview);
        output.OverallQuality.Should().Be("Acceptable");
        output.Score.Should().Be(85);
        output.CodeReviewIssues.Should().HaveCount(1);
        output.Positives.Should().HaveCount(1);
        output.LearningOpportunities.Should().HaveCount(1);
    }

    [Test]
    public void ClaudeAnalysisOutput_BlockerDiagnosis_ShouldContainDiagnosisFields()
    {
        // Arrange
        var output = new ClaudeAnalysisOutput
        {
            Success = true,
            AnalysisType = AnalysisType.BlockerDiagnosis,
            Confidence = 0.8,
            DiagnosedBlockerType = "TechnicalKnowledgeGap",
            RootCause = "Unfamiliarity with async/await patterns",
            Evidence = new List<string>
            {
                "Multiple attempts at same code pattern",
                "Error messages related to promises"
            },
            RecommendedIntervention = "Guidance",
            ImmediateAction = "Explain async/await fundamentals"
        };

        // Assert
        output.AnalysisType.Should().Be(AnalysisType.BlockerDiagnosis);
        output.DiagnosedBlockerType.Should().Be("TechnicalKnowledgeGap");
        output.RootCause.Should().NotBeEmpty();
        output.Evidence.Should().HaveCount(2);
        output.RecommendedIntervention.Should().Be("Guidance");
    }

    [Test]
    public void ClaudeAnalysisOutput_GuidanceGeneration_ShouldContainGuidanceFields()
    {
        // Arrange
        var output = new ClaudeAnalysisOutput
        {
            Success = true,
            AnalysisType = AnalysisType.GuidanceGeneration,
            Confidence = 0.9,
            MainGuidance = "Let's break this problem down into smaller pieces",
            Steps = new List<string>
            {
                "First, identify what data you need",
                "Then, write a simple function to fetch that data",
                "Finally, use the data in your component"
            },
            Examples = new List<string> { "Here's a similar pattern: UserService.GetUser()" },
            SocraticQuestions = new List<string>
            {
                "What should this function return?",
                "What happens if the data isn't available?"
            },
            Resources = new List<string> { "MDN async/await guide" },
            Encouragement = "You're making great progress!"
        };

        // Assert
        output.AnalysisType.Should().Be(AnalysisType.GuidanceGeneration);
        output.MainGuidance.Should().NotBeEmpty();
        output.Steps.Should().HaveCount(3);
        output.Examples.Should().HaveCount(1);
        output.SocraticQuestions.Should().HaveCount(2);
        output.Encouragement.Should().NotBeEmpty();
    }

    [Test]
    public void ClaudeAnalysisOutput_Failure_ShouldIndicateFallback()
    {
        // Arrange
        var output = new ClaudeAnalysisOutput
        {
            Success = false,
            AnalysisType = AnalysisType.Assessment,
            Message = "Analysis failed: API timeout",
            Confidence = 0,
            FallbackUsed = true
        };

        // Assert
        output.Success.Should().BeFalse();
        output.FallbackUsed.Should().BeTrue();
        output.Confidence.Should().Be(0);
        output.Message.Should().Contain("failed");
    }

    [Test]
    public void CodeReviewIssue_ShouldStoreAllFields()
    {
        // Arrange
        var issue = new CodeReviewIssue
        {
            Severity = "Major",
            Location = "src/Services/UserService.cs:45",
            Issue = "Missing null check before accessing property",
            Suggestion = "Add if (user == null) return null; before line 45"
        };

        // Assert
        issue.Severity.Should().Be("Major");
        issue.Location.Should().Contain("UserService");
        issue.Issue.Should().NotBeEmpty();
        issue.Suggestion.Should().NotBeEmpty();
    }

    [Test]
    public void ClaudeAnalysisOutput_DefaultValues_ShouldBeEmpty()
    {
        // Arrange
        var output = new ClaudeAnalysisOutput();

        // Assert
        output.Success.Should().BeFalse();
        output.Confidence.Should().Be(0);
        output.Gaps.Should().BeEmpty();
        output.Strengths.Should().BeEmpty();
        output.CodeReviewIssues.Should().BeEmpty();
        output.Evidence.Should().BeEmpty();
        output.Steps.Should().BeEmpty();
        output.Examples.Should().BeEmpty();
        output.SocraticQuestions.Should().BeEmpty();
        output.Resources.Should().BeEmpty();
    }
}
