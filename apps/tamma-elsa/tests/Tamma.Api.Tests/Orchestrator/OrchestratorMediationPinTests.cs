using FluentAssertions;
using NUnit.Framework;
using Tamma.Api.Services.Agents;
using Tamma.Api.Services.Orchestrator;

namespace Tamma.Api.Tests.Orchestrator;

/// <summary>
/// Story 39-17 (D2) — reflection pin on the <see cref="IInlineToolLoopRunner"/>
/// mediation allowlist inside <c>Tamma.Api</c>. Only <see cref="ManagedAgent"/>
/// and <see cref="ToolLoopTurnRunner"/> may consume
/// <see cref="IInlineToolLoopRunner"/> directly; no new unmediated LLM caller
/// may appear in <c>Tamma.Api</c>.
/// </summary>
[TestFixture]
public class OrchestratorMediationPinTests
{
    [Test]
    public void Only_ManagedAgent_and_ToolLoopTurnRunner_consume_IInlineToolLoopRunner()
    {
        var apiAssembly = typeof(ManagedAgent).Assembly;
        var consumers = apiAssembly
            .GetTypes()
            .Where(t => t is { IsClass: true, IsAbstract: false })
            .Where(t => t.GetConstructors()
                .Any(c => c.GetParameters().Any(p => p.ParameterType == typeof(IInlineToolLoopRunner))))
            .Select(t => t.FullName!)
            .OrderBy(n => n, StringComparer.Ordinal)
            .ToArray();

        consumers.Should().BeEquivalentTo(new[]
        {
            typeof(ManagedAgent).FullName!,
            typeof(ToolLoopTurnRunner).FullName!,
        }, "Story 39-17 D2: only ManagedAgent and ToolLoopTurnRunner are allowlisted to inject IInlineToolLoopRunner in Tamma.Api");
    }
}
