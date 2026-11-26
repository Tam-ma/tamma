using System.Security.Cryptography;
using FluentAssertions;
using NUnit.Framework;

namespace Tamma.Activities.Tests.ADL;

/// <summary>
/// Story 44-7 AC9 (D3, Test 13) — pins the SHA-256 hash of
/// <c>SingleIssueCycleWorkflow.cs</c> to guarantee Story 44-7 stays completely
/// out of the contended 40-2 → 40-4 → 40-5 → 41-29 merge chain on that file.
/// </summary>
[TestFixture]
public class SingleIssueCycleUntouchedTests
{
    private const string PinnedSha256 = "9d58e987d3baa884b280ad19ca2c81242eb3f48051d2a33336c8a51699c4bca3";

    [Test]
    public void Workflow_file_is_unmodified()
    {
        var path = LocateSingleIssueCycleWorkflow();
        var bytes = File.ReadAllBytes(path);
        var hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

        hash.Should().Be(PinnedSha256,
            "Story 44-7 AC9 / D3: SingleIssueCycleWorkflow.cs must remain byte-unchanged by Story 44-7 "
            + "(contended 40-2 → 40-4 → 40-5 → 41-29 merge chain)");
    }

    private static string LocateSingleIssueCycleWorkflow()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var candidate = Path.Combine(
                dir.FullName, "apps", "tamma-elsa", "src", "Tamma.ElsaServer",
                "Workflows", "SingleIssueCycleWorkflow.cs");
            if (File.Exists(candidate))
                return candidate;
            dir = dir.Parent;
        }
        throw new InvalidOperationException("Could not locate SingleIssueCycleWorkflow.cs.");
    }
}
