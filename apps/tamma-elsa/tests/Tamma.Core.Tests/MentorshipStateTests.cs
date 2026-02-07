using FluentAssertions;
using NUnit.Framework;
using Tamma.Core.Enums;

namespace Tamma.Core.Tests;

[TestFixture]
public class MentorshipStateTests
{
    [Test]
    public void MentorshipState_ShouldHaveAllExpectedStates()
    {
        // Arrange
        var expectedStates = new[]
        {
            "INIT_STORY_PROCESSING",
            "VALIDATE_STORY",
            "ASSESS_JUNIOR_CAPABILITY",
            "CLARIFY_REQUIREMENTS",
            "RE_EXPLAIN_STORY",
            "PLAN_DECOMPOSITION",
            "REVIEW_PLAN",
            "ADJUST_PLAN",
            "START_IMPLEMENTATION",
            "MONITOR_PROGRESS",
            "PROVIDE_GUIDANCE",
            "DETECT_PATTERN",
            "DIAGNOSE_BLOCKER",
            "PROVIDE_HINT",
            "PROVIDE_ASSISTANCE",
            "ESCALATE_TO_SENIOR",
            "QUALITY_GATE_CHECK",
            "AUTO_FIX_ISSUES",
            "MANUAL_FIX_REQUIRED",
            "PREPARE_CODE_REVIEW",
            "MONITOR_REVIEW",
            "GUIDE_FIXES",
            "RE_REQUEST_REVIEW",
            "MERGE_AND_COMPLETE",
            "GENERATE_REPORT",
            "UPDATE_SKILL_PROFILE",
            "COMPLETED",
            "PAUSED",
            "CANCELLED",
            "FAILED",
            "TIMEOUT"
        };

        // Act
        var actualStates = Enum.GetNames(typeof(MentorshipState));

        // Assert
        actualStates.Should().Contain(expectedStates);
    }

    [Test]
    public void MentorshipState_InitStoryProcessing_ShouldBeFirst()
    {
        // Assert
        ((int)MentorshipState.INIT_STORY_PROCESSING).Should().Be(0);
    }

    [Test]
    public void MentorshipState_CanConvertToString()
    {
        // Arrange
        var state = MentorshipState.ASSESS_JUNIOR_CAPABILITY;

        // Act
        var stateString = state.ToString();

        // Assert
        stateString.Should().Be("ASSESS_JUNIOR_CAPABILITY");
    }

    [Test]
    public void MentorshipState_CanParseFromString()
    {
        // Arrange
        var stateString = "QUALITY_GATE_CHECK";

        // Act
        var parsed = Enum.TryParse<MentorshipState>(stateString, out var state);

        // Assert
        parsed.Should().BeTrue();
        state.Should().Be(MentorshipState.QUALITY_GATE_CHECK);
    }
}

[TestFixture]
public class BlockerTypeTests
{
    [Test]
    public void BlockerType_ShouldHaveExpectedTypes()
    {
        // Arrange
        var expectedTypes = new[]
        {
            "REQUIREMENTS_UNCLEAR",
            "TECHNICAL_KNOWLEDGE_GAP",
            "ENVIRONMENT_ISSUE",
            "DEPENDENCY_ISSUE",
            "ARCHITECTURE_CONFUSION",
            "TESTING_CHALLENGE",
            "REVIEW_FEEDBACK_UNCLEAR",
            "PERFORMANCE_ISSUE",
            "SECURITY_CONCERN",
            "EXTERNAL_DEPENDENCY",
            "AVAILABILITY_ISSUE",
            "MOTIVATION_ISSUE",
            "COMMUNICATION_ISSUE",
            "UNKNOWN"
        };

        // Act
        var actualTypes = Enum.GetNames(typeof(BlockerType));

        // Assert
        actualTypes.Should().BeEquivalentTo(expectedTypes);
    }
}

[TestFixture]
public class AssessmentStatusTests
{
    [Test]
    public void AssessmentStatus_ShouldHaveExpectedValues()
    {
        // Assert
        Enum.GetValues<AssessmentStatus>().Should().Contain(AssessmentStatus.Correct);
        Enum.GetValues<AssessmentStatus>().Should().Contain(AssessmentStatus.Partial);
        Enum.GetValues<AssessmentStatus>().Should().Contain(AssessmentStatus.Incorrect);
        Enum.GetValues<AssessmentStatus>().Should().Contain(AssessmentStatus.Timeout);
        Enum.GetValues<AssessmentStatus>().Should().Contain(AssessmentStatus.Error);
    }
}

[TestFixture]
public class QualityGateTypeTests
{
    [Test]
    public void QualityGateType_ShouldHaveExpectedTypes()
    {
        // Assert
        Enum.GetValues<QualityGateType>().Should().Contain(QualityGateType.UnitTests);
        Enum.GetValues<QualityGateType>().Should().Contain(QualityGateType.IntegrationTests);
        Enum.GetValues<QualityGateType>().Should().Contain(QualityGateType.CodeCoverage);
        Enum.GetValues<QualityGateType>().Should().Contain(QualityGateType.Linting);
        Enum.GetValues<QualityGateType>().Should().Contain(QualityGateType.StaticAnalysis);
        Enum.GetValues<QualityGateType>().Should().Contain(QualityGateType.SecurityScan);
        Enum.GetValues<QualityGateType>().Should().Contain(QualityGateType.BuildCompilation);
    }
}
