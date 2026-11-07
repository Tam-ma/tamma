using System.Text.Json;
using FluentAssertions;
using NUnit.Framework;
using Tamma.ElsaServer.Workflows;

namespace Tamma.Activities.Tests.Workflows;

/// <summary>
/// <see cref="LlmCallWorkflow.BuildVariablesJson"/> must never mutate the caller's
/// <c>variables</c> dictionary. An in-process DispatchWorkflow shares that instance
/// with the parent's activity state; mutating it raced the parent's state commit
/// ("Collection was modified"), the parent was never persisted, and the cycle hung
/// (the nightly Gitea engine-driven E2E flake).
/// </summary>
[TestFixture]
public class LlmCallWorkflowVariablesTests
{
    [Test]
    public void BuildVariablesJson_DoesNotMutateCallerDictionary()
    {
        var callerVariables = new Dictionary<string, object> { ["workItemJson"] = "{}" };

        LlmCallWorkflow.BuildVariablesJson(callerVariables, "developer", "legacy conventions");

        callerVariables.Should().HaveCount(1);
        callerVariables.Should().ContainKey("workItemJson");
        callerVariables.Should().NotContainKey("role");
        callerVariables.Should().NotContainKey("conventions");
    }

    [Test]
    public void BuildVariablesJson_InjectsRoleAndConventionsWhenAbsent()
    {
        var json = LlmCallWorkflow.BuildVariablesJson(
            new Dictionary<string, object> { ["workItemJson"] = "{}" }, "developer", "legacy conventions");

        var result = JsonSerializer.Deserialize<Dictionary<string, string>>(json)!;
        result.Should().Contain("role", "developer");
        result.Should().Contain("conventions", "legacy conventions");
        result.Should().Contain("workItemJson", "{}");
    }

    [Test]
    public void BuildVariablesJson_KeepsCallerSuppliedRoleAndConventions()
    {
        var json = LlmCallWorkflow.BuildVariablesJson(
            new Dictionary<string, object> { ["role"] = "tester", ["conventions"] = "caller conventions" },
            "developer", "legacy conventions");

        var result = JsonSerializer.Deserialize<Dictionary<string, string>>(json)!;
        result.Should().Contain("role", "tester");
        result.Should().Contain("conventions", "caller conventions");
    }
}
