using System.Reflection;
using System.Text.RegularExpressions;
using FluentAssertions;
using NUnit.Framework;
using Tamma.Activities.AgentDispatch;
using Tamma.Api.Services.AgentDispatch;
using Tamma.Api.Services.Agents;

namespace Tamma.Api.Tests.AgentDispatch;

/// <summary>
/// Story 40-6 — pins the agent-run wait event names (AC1, AC8), keeps them apart from the
/// neighbouring families (AC5), and keeps every emitter on the one list.
/// </summary>
[TestFixture]
public class AgentRunWaitEventTypesTests
{
    /// <summary>
    /// AC8: the strings are already in an append-only stream and 40-4 reads them back.
    /// Changing one is a stream migration — this test failing is the prompt to have that talk.
    /// </summary>
    [Test]
    public void Wire_strings_are_frozen()
    {
        AgentRunWaitEventTypes.WaitSuspended.Should().Be("AGENT_RUN.WAIT_SUSPENDED");
        AgentRunWaitEventTypes.Received.Should().Be("AGENT_RUN.RECEIVED");
        AgentRunWaitEventTypes.TimedOut.Should().Be("AGENT_RUN.TIMED_OUT");
        AgentRunWaitEventTypes.ResumeUnresolved.Should().Be("AGENT_RUN.RESUME_UNRESOLVED");
        AgentRunWaitEventTypes.TaskReentered.Should().Be("AGENT_RUN.TASK_REENTERED");
    }

    [Test]
    public void All_lists_exactly_the_five_constants()
    {
        AgentRunWaitEventTypes.All.Should().BeEquivalentTo(Constants(typeof(AgentRunWaitEventTypes)));
        AgentRunWaitEventTypes.All.Should().HaveCount(5).And.OnlyHaveUniqueItems();
    }

    [Test]
    public void Wake_paths_are_frozen()
    {
        AgentRunWaitEventTypes.WakePaths.Webhook.Should().Be("webhook");
        AgentRunWaitEventTypes.WakePaths.Poll.Should().Be("poll");
        AgentRunWaitEventTypes.WakePaths.Local.Should().Be("local");
    }

    /// <summary>
    /// AC5: <c>AGENT.RUN.*</c> (32-5) is one character away from <c>AGENT_RUN.*</c>, and
    /// analytics sweeps up anything starting <c>AGENT.DISPATCH.</c>.
    /// </summary>
    [Test]
    public void No_name_can_be_mistaken_for_a_neighbouring_family()
    {
        foreach (var t in AgentRunWaitEventTypes.All)
        {
            t.Should().StartWith("AGENT_RUN.");
            t.Should().NotStartWith("AGENT.RUN.");
            t.Should().NotStartWith("AGENT.DISPATCH.");
            t.Split('.').Should().HaveCount(2, "the wait family uses two-segment names, like DOCUMENT.REENTERED");
        }

        var neighbours = Constants(typeof(AgentRunEventTypes))
            .Concat(Constants(typeof(AgentDispatchEventTypes)))
            .Concat(Constants(typeof(AgentTrailEventTypes)));
        AgentRunWaitEventTypes.All.Should().NotIntersectWith(neighbours);
    }

    [TestCase(AgentRunWaitEventTypes.WaitSuspended, "started")]
    [TestCase(AgentRunWaitEventTypes.Received, "success")]
    [TestCase(AgentRunWaitEventTypes.TimedOut, "error")]
    [TestCase(AgentRunWaitEventTypes.ResumeUnresolved, "error")]
    [TestCase(AgentRunWaitEventTypes.TaskReentered, "success")]
    public void Status_per_type(string type, string status)
        => AgentRunWaitEventTypes.StatusFor(type).Should().Be(status);

    /// <summary>
    /// One list, not scattered literals (Technical Notes): outside the catalogue file, no
    /// source file under src/ spells an <c>AGENT_RUN.</c> string.
    /// </summary>
    [Test]
    public void No_source_file_spells_the_strings_inline()
    {
        var src = SrcRoot();
        var catalogue = Path.Combine(src, "Tamma.Activities", "AgentDispatch", "AgentRunWaitEventTypes.cs");
        var sep = Path.DirectorySeparatorChar;

        var offenders = Directory.EnumerateFiles(src, "*.cs", SearchOption.AllDirectories)
            .Where(f => !f.Contains($"{sep}obj{sep}") && !f.Contains($"{sep}bin{sep}"))
            .Where(f => !string.Equals(Path.GetFullPath(f), Path.GetFullPath(catalogue), StringComparison.Ordinal))
            .Where(f => Regex.IsMatch(File.ReadAllText(f), "\"AGENT_RUN\\.[A-Z_]+\""))
            .Select(f => Path.GetRelativePath(src, f))
            .ToList();

        offenders.Should().BeEmpty("emitters must reference AgentRunWaitEventTypes, not repeat its strings");
    }

    private static IEnumerable<string> Constants(Type t) =>
        t.GetFields(BindingFlags.Public | BindingFlags.Static)
            .Where(f => f.IsLiteral && f.FieldType == typeof(string))
            .Select(f => (string)f.GetRawConstantValue()!);

    private static string SrcRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var direct = Path.Combine(dir.FullName, "src", "Tamma.Activities");
            if (Directory.Exists(direct)) return Path.Combine(dir.FullName, "src");
            var nested = Path.Combine(dir.FullName, "apps", "tamma-elsa", "src", "Tamma.Activities");
            if (Directory.Exists(nested)) return Path.Combine(dir.FullName, "apps", "tamma-elsa", "src");
            dir = dir.Parent;
        }
        throw new DirectoryNotFoundException("Could not locate apps/tamma-elsa/src from " + AppContext.BaseDirectory);
    }
}
