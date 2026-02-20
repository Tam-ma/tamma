using FluentAssertions;
using Microsoft.Extensions.Logging;
using Moq;
using NUnit.Framework;
using Tamma.Activities.AI;
using Tamma.Core.Interfaces;
using Tamma.Data.Repositories;

namespace Tamma.Activities.Tests.AI;

[TestFixture]
public class SuggestionGeneratorActivityTests
{
    private Mock<ILogger<SuggestionGeneratorActivity>> _mockLogger = null!;
    private Mock<IMentorshipSessionRepository> _mockRepository = null!;
    private Mock<IAnalyticsService> _mockAnalyticsService = null!;

    [SetUp]
    public void SetUp()
    {
        _mockLogger = new Mock<ILogger<SuggestionGeneratorActivity>>();
        _mockRepository = new Mock<IMentorshipSessionRepository>();
        _mockAnalyticsService = new Mock<IAnalyticsService>();
    }

    [Test]
    public void Constructor_WithValidDependencies_ShouldNotThrow()
    {
        // Act
        Action act = () => new SuggestionGeneratorActivity(
            _mockLogger.Object,
            _mockRepository.Object,
            _mockAnalyticsService.Object);

        // Assert
        act.Should().NotThrow();
    }

    [Test]
    public void SuggestionType_ShouldHaveExpectedValues()
    {
        // Assert
        Enum.GetValues<SuggestionType>().Should().HaveCount(5);
        Enum.GetValues<SuggestionType>().Should().Contain(SuggestionType.CodeQuality);
        Enum.GetValues<SuggestionType>().Should().Contain(SuggestionType.Architecture);
        Enum.GetValues<SuggestionType>().Should().Contain(SuggestionType.Testing);
        Enum.GetValues<SuggestionType>().Should().Contain(SuggestionType.Performance);
        Enum.GetValues<SuggestionType>().Should().Contain(SuggestionType.Learning);
    }

    [Test]
    public void SuggestionCategory_ShouldHaveExpectedValues()
    {
        // Assert
        Enum.GetValues<SuggestionCategory>().Should().Contain(SuggestionCategory.CodeQuality);
        Enum.GetValues<SuggestionCategory>().Should().Contain(SuggestionCategory.Architecture);
        Enum.GetValues<SuggestionCategory>().Should().Contain(SuggestionCategory.Testing);
        Enum.GetValues<SuggestionCategory>().Should().Contain(SuggestionCategory.Performance);
        Enum.GetValues<SuggestionCategory>().Should().Contain(SuggestionCategory.Learning);
        Enum.GetValues<SuggestionCategory>().Should().Contain(SuggestionCategory.BestPractices);
    }

    [Test]
    public void Priority_ShouldHaveExpectedValues()
    {
        // Assert
        Enum.GetValues<Priority>().Should().HaveCount(4);
        Enum.GetValues<Priority>().Should().Contain(Priority.Low);
        Enum.GetValues<Priority>().Should().Contain(Priority.Medium);
        Enum.GetValues<Priority>().Should().Contain(Priority.High);
        Enum.GetValues<Priority>().Should().Contain(Priority.Critical);
    }

    [Test]
    public void Suggestion_ShouldStoreAllFields()
    {
        // Arrange
        var suggestion = new Suggestion
        {
            Category = SuggestionCategory.CodeQuality,
            Title = "Use meaningful variable names",
            Description = "Variable names should describe what they contain",
            Priority = Priority.Medium,
            Effort = EffortLevel.Low,
            Impact = ImpactLevel.Medium,
            Location = "src/Services/UserService.cs:45",
            ActionItems = new List<string>
            {
                "Review variable names in the file",
                "Rename ambiguous variables",
                "Run tests to verify changes"
            },
            RelatedFiles = new List<string> { "UserService.cs", "UserController.cs" },
            LearnMoreUrl = "https://wiki.internal/naming-conventions",
            IsLearningPath = false,
            RelevanceScore = 75.5
        };

        // Assert
        suggestion.Category.Should().Be(SuggestionCategory.CodeQuality);
        suggestion.Title.Should().NotBeEmpty();
        suggestion.Description.Should().NotBeEmpty();
        suggestion.Priority.Should().Be(Priority.Medium);
        suggestion.Effort.Should().Be(EffortLevel.Low);
        suggestion.Impact.Should().Be(ImpactLevel.Medium);
        suggestion.ActionItems.Should().HaveCount(3);
        suggestion.RelatedFiles.Should().HaveCount(2);
        suggestion.RelevanceScore.Should().BeGreaterThan(0);
    }

    [Test]
    public void SuggestionsOutput_Success_ShouldContainSuggestions()
    {
        // Arrange
        var output = new SuggestionsOutput
        {
            Success = true,
            SuggestionType = SuggestionType.CodeQuality,
            Suggestions = new List<Suggestion>
            {
                new Suggestion
                {
                    Title = "Add null checks",
                    Priority = Priority.High
                },
                new Suggestion
                {
                    Title = "Extract method",
                    Priority = Priority.Medium
                }
            },
            TotalGenerated = 2,
            Summary = "Found 1 high priority improvement(s) recommended."
        };

        // Assert
        output.Success.Should().BeTrue();
        output.Suggestions.Should().HaveCount(2);
        output.TotalGenerated.Should().Be(2);
        output.Summary.Should().NotBeEmpty();
    }

    [Test]
    public void SuggestionsOutput_Failure_ShouldContainErrorMessage()
    {
        // Arrange
        var output = new SuggestionsOutput
        {
            Success = false,
            Message = "Suggestion generation failed: Junior developer not found"
        };

        // Assert
        output.Success.Should().BeFalse();
        output.Message.Should().Contain("failed");
        output.Suggestions.Should().BeEmpty();
    }

    [Test]
    public void Suggestion_LearningPath_ShouldBeMarked()
    {
        // Arrange
        var suggestion = new Suggestion
        {
            Category = SuggestionCategory.Learning,
            Title = "Learn about design patterns",
            Description = "Understanding common patterns will help you write better code",
            Priority = Priority.Medium,
            IsLearningPath = true,
            LearnMoreUrl = "https://wiki.internal/design-patterns"
        };

        // Assert
        suggestion.IsLearningPath.Should().BeTrue();
        suggestion.Category.Should().Be(SuggestionCategory.Learning);
        suggestion.LearnMoreUrl.Should().NotBeEmpty();
    }

    [Test]
    public void EffortLevel_ShouldHaveExpectedValues()
    {
        // Assert
        Enum.GetValues<EffortLevel>().Should().HaveCount(3);
        Enum.GetValues<EffortLevel>().Should().Contain(EffortLevel.Low);
        Enum.GetValues<EffortLevel>().Should().Contain(EffortLevel.Medium);
        Enum.GetValues<EffortLevel>().Should().Contain(EffortLevel.High);
    }

    [Test]
    public void ImpactLevel_ShouldHaveExpectedValues()
    {
        // Assert
        Enum.GetValues<ImpactLevel>().Should().HaveCount(4);
        Enum.GetValues<ImpactLevel>().Should().Contain(ImpactLevel.Low);
        Enum.GetValues<ImpactLevel>().Should().Contain(ImpactLevel.Medium);
        Enum.GetValues<ImpactLevel>().Should().Contain(ImpactLevel.High);
        Enum.GetValues<ImpactLevel>().Should().Contain(ImpactLevel.Critical);
    }

    [Test]
    public void Suggestion_CriticalPriority_ShouldHaveHighRelevance()
    {
        // Arrange
        var suggestion = new Suggestion
        {
            Title = "Fix security vulnerability",
            Priority = Priority.Critical,
            Effort = EffortLevel.Low,
            Impact = ImpactLevel.Critical,
            RelevanceScore = 170 // Critical(100) + Critical Impact(40) + Low Effort(30)
        };

        // Assert
        suggestion.Priority.Should().Be(Priority.Critical);
        suggestion.RelevanceScore.Should().BeGreaterThan(100);
    }

    [Test]
    public void SuggestionsOutput_DefaultValues_ShouldBeEmpty()
    {
        // Arrange
        var output = new SuggestionsOutput();

        // Assert
        output.Success.Should().BeFalse();
        output.Suggestions.Should().BeEmpty();
        output.TotalGenerated.Should().Be(0);
        output.Summary.Should().BeNull();
    }

    [Test]
    public void Suggestion_TestingCategory_ShouldIncludeTestGuidance()
    {
        // Arrange
        var suggestion = new Suggestion
        {
            Category = SuggestionCategory.Testing,
            Title = "Increase test coverage",
            Description = "Current coverage is 65%. Target is 80%.",
            Priority = Priority.High,
            ActionItems = new List<string>
            {
                "Identify untested code paths",
                "Write tests for each public method",
                "Include edge cases and error scenarios"
            }
        };

        // Assert
        suggestion.Category.Should().Be(SuggestionCategory.Testing);
        suggestion.ActionItems.Should().HaveCount(3);
        suggestion.Description.Should().Contain("coverage");
    }
}
