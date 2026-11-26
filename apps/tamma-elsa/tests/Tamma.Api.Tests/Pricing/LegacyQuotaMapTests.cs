using FluentAssertions;
using Microsoft.Extensions.Logging;
using Moq;
using NUnit.Framework;
using Tamma.Api.Services.Pricing;
using Tamma.Core.Enums;

namespace Tamma.Api.Tests.Pricing;

/// <summary>
/// Story 34-10 (AC1, AC13) — unit tests for <see cref="LegacyQuotaMap"/>:
/// legacy <c>Plan.Quotas</c> JSON conversion to typed <c>EntitlementMetricKey</c>
/// specs, <c>-1</c>/null unlimited mapping, dropped <c>concurrentWorkflows</c>
/// WARN, and malformed JSON resilience.
/// </summary>
[TestFixture]
public class LegacyQuotaMapTests
{
    [Test]
    public void Parse_Maps_LlmTokensPerMonth_And_Seats_And_Converts_MinusOne_To_Null()
    {
        var logger = new Mock<ILogger>();

        var finite = LegacyQuotaMap.Parse(
            "team",
            """{"llmTokensPerMonth":2000000,"seats":10}""",
            logger.Object);

        finite.Should().HaveCount(2);
        finite.Should().Contain(s => s.MetricKey == EntitlementMetricKey.LlmTokens && s.LimitValue == 2_000_000L);
        finite.Should().Contain(s => s.MetricKey == EntitlementMetricKey.Seats && s.LimitValue == 10L);

        var unlimited = LegacyQuotaMap.Parse(
            "enterprise",
            """{"llmTokensPerMonth":-1,"seats":null}""",
            logger.Object);

        unlimited.Should().HaveCount(2);
        unlimited.Should().Contain(s => s.MetricKey == EntitlementMetricKey.LlmTokens && s.LimitValue == null);
        unlimited.Should().Contain(s => s.MetricKey == EntitlementMetricKey.Seats && s.LimitValue == null);
    }

    [Test]
    public void Parse_Drops_ConcurrentWorkflows_And_Logs_Warning()
    {
        var logger = new Mock<ILogger>();

        var specs = LegacyQuotaMap.Parse(
            "free",
            """{"llmTokensPerMonth":100000,"concurrentWorkflows":2,"seats":1}""",
            logger.Object);

        specs.Should().HaveCount(2);
        specs.Select(s => s.MetricKey).Should().BeEquivalentTo(
            [EntitlementMetricKey.LlmTokens, EntitlementMetricKey.Seats]);

        logger.Verify(
            l => l.Log(
                LogLevel.Warning,
                It.IsAny<EventId>(),
                It.Is<It.IsAnyType>((v, _) => v.ToString()!.Contains("concurrentWorkflows")),
                It.IsAny<Exception?>(),
                It.IsAny<Func<It.IsAnyType, Exception?, string>>()),
            Times.Once);
    }

    [Test]
    public void Parse_Handles_Empty_And_Malformed_Json_Without_Throwing()
    {
        var logger = new Mock<ILogger>();

        LegacyQuotaMap.Parse("empty", "{}", logger.Object).Should().BeEmpty();
        LegacyQuotaMap.Parse("blank", "", logger.Object).Should().BeEmpty();
        LegacyQuotaMap.Parse("null", null, logger.Object).Should().BeEmpty();
        LegacyQuotaMap.Parse("bad", "{broken json", logger.Object).Should().BeEmpty();
        LegacyQuotaMap.Parse("arr", "[1,2,3]", logger.Object).Should().BeEmpty();

        logger.Verify(
            l => l.Log(
                LogLevel.Warning,
                It.IsAny<EventId>(),
                It.IsAny<It.IsAnyType>(),
                It.IsAny<Exception?>(),
                It.IsAny<Func<It.IsAnyType, Exception?, string>>()),
            Times.Exactly(2));
    }
}
