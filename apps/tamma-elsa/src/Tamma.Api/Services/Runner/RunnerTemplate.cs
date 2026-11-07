using System.Reflection;

namespace Tamma.Api.Services.Runner;

/// <summary>One file of the canonical runner set, at its install path in a user repo.</summary>
/// <param name="RepoPath">Install path, e.g. <c>.github/tamma/scripts/collect-results.sh</c>.</param>
/// <param name="Content">The shipped bytes, verbatim.</param>
/// <param name="Executable">Committed with mode 100755 (the workflow runs the scripts directly).</param>
public sealed record RunnerTemplateFile(string RepoPath, byte[] Content, bool Executable);

/// <summary>
/// Story 40-1 AC7 — the canonical runner set Tamma ships
/// (<c>apps/tamma-elsa/runner/github-actions/</c>), as the scaffold commits it.
/// </summary>
public interface IRunnerTemplate
{
    /// <summary>The <c>tamma-runner-version</c> marker of the shipped workflow.</summary>
    string Version { get; }

    /// <summary>The workflow first, then the scripts (ordinal by path).</summary>
    IReadOnlyList<RunnerTemplateFile> Files { get; }
}

/// <summary>
/// Parses the <c>tamma-runner-version</c> marker exactly the way
/// <c>install-runner.sh</c> does (<c>sed -n 's/^# tamma-runner-version: //p' | head -n1</c>):
/// the remainder of the FIRST line that starts with the marker, byte-for-byte
/// (a trailing <c>\r</c> is kept, as sed keeps it). No marker ⇒ null, which never
/// equals a shipped version — the script's "drifted".
/// </summary>
public static class RunnerVersionMarker
{
    /// <summary>The marker prefix.</summary>
    public const string Prefix = "# tamma-runner-version: ";

    /// <summary>The version a file declares, or null when it has no marker line.</summary>
    public static string? Parse(byte[] content)
    {
        ArgumentNullException.ThrowIfNull(content);
        var text = System.Text.Encoding.UTF8.GetString(content);
        foreach (var line in text.Split('\n'))
        {
            if (line.StartsWith(Prefix, StringComparison.Ordinal))
                return line[Prefix.Length..];
        }
        return null;
    }
}

/// <summary>
/// The runner set embedded into <c>Tamma.Api</c> at build time (see the csproj's
/// <c>TammaRunner/*</c> resources). Resource → install path:
/// <c>TammaRunner/workflows/{f}</c> → <c>.github/workflows/{f}</c>;
/// <c>TammaRunner/scripts/{f}</c> → <c>.github/tamma/scripts/{f}</c> (executable).
/// Fail-loud on construction: an empty set, no workflow, or a workflow with no
/// version marker is a packaging bug, not a runtime condition.
/// </summary>
public sealed class EmbeddedRunnerTemplate : IRunnerTemplate
{
    internal const string WorkflowPrefix = "TammaRunner/workflows/";
    internal const string ScriptPrefix = "TammaRunner/scripts/";
    internal const string WorkflowInstallDir = ".github/workflows/";
    internal const string ScriptInstallDir = ".github/tamma/scripts/";

    /// <inheritdoc />
    public string Version { get; }

    /// <inheritdoc />
    public IReadOnlyList<RunnerTemplateFile> Files { get; }

    /// <summary>Load from <c>Tamma.Api</c>'s own manifest resources.</summary>
    public EmbeddedRunnerTemplate() : this(typeof(EmbeddedRunnerTemplate).Assembly) { }

    /// <summary>Load from <paramref name="assembly"/> (tests).</summary>
    public EmbeddedRunnerTemplate(Assembly assembly)
    {
        ArgumentNullException.ThrowIfNull(assembly);
        var workflows = new List<RunnerTemplateFile>();
        var scripts = new List<RunnerTemplateFile>();
        foreach (var name in assembly.GetManifestResourceNames().OrderBy(n => n, StringComparer.Ordinal))
        {
            if (name.StartsWith(WorkflowPrefix, StringComparison.Ordinal))
                workflows.Add(new RunnerTemplateFile(WorkflowInstallDir + name[WorkflowPrefix.Length..], Read(assembly, name), Executable: false));
            else if (name.StartsWith(ScriptPrefix, StringComparison.Ordinal))
                scripts.Add(new RunnerTemplateFile(ScriptInstallDir + name[ScriptPrefix.Length..], Read(assembly, name), Executable: true));
        }

        if (workflows.Count != 1)
            throw new InvalidOperationException(
                $"Story 40-1: expected exactly one embedded runner workflow under '{WorkflowPrefix}', found {workflows.Count}.");
        if (scripts.Count == 0)
            throw new InvalidOperationException(
                $"Story 40-1: no embedded runner scripts under '{ScriptPrefix}'.");

        Version = RunnerVersionMarker.Parse(workflows[0].Content)
            ?? throw new InvalidOperationException(
                $"Story 40-1: the embedded runner workflow has no '{RunnerVersionMarker.Prefix.Trim()}' marker.");
        Files = [.. workflows, .. scripts];
    }

    private static byte[] Read(Assembly assembly, string name)
    {
        using var stream = assembly.GetManifestResourceStream(name)
            ?? throw new InvalidOperationException($"embedded resource '{name}' disappeared");
        using var ms = new MemoryStream();
        stream.CopyTo(ms);
        return ms.ToArray();
    }
}
