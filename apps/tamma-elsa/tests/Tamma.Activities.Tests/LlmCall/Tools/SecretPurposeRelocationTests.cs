using System.Xml.Linq;
using FluentAssertions;
using NUnit.Framework;
using Tamma.Activities.LlmCall.Tools;
using Tamma.Api.Services.Secrets;

namespace Tamma.Activities.Tests.LlmCall.Tools;

/// <summary>
/// Story 42-1 AC1 / D1: proves Epic 29's <see cref="SecretPurpose"/> physically moved into
/// <c>Tamma.Core</c>, keeps its exact 7 members in order, is directly reachable from
/// <c>Tamma.Activities</c> (<see cref="SecretRequirement"/>), and adds no project references.
/// </summary>
[TestFixture]
public class SecretPurposeRelocationTests
{
    [Test]
    public void SecretPurpose_HasExactSevenMembers_InCanonicalOrder()
    {
        var values = Enum.GetValues<SecretPurpose>();

        values.Should().HaveCount(7);
        values.Select(v => v.ToString()).Should().ContainInOrder(
            "DbCredential",
            "ApiKey",
            "SigningKey",
            "HmacSharedSecret",
            "Webhook",
            "Connection",
            "Other");
    }

    [Test]
    public void SecretPurpose_LivesInTammaCoreAssembly_WithNoDuplicateInTammaApi()
    {
        typeof(SecretPurpose).Assembly.GetName().Name.Should().Be("Tamma.Core");

        var apiAssembly = typeof(Tamma.Api.Services.AcceptanceRules.GetAcceptanceRulesTool).Assembly;
        apiAssembly.GetTypes()
            .Where(t => t.Name == nameof(SecretPurpose))
            .Should().BeEmpty("SecretPurpose was moved, not mirrored");
    }

    [Test]
    public void SecretRequirement_InTammaActivities_DirectlyCarriesSecretPurpose()
    {
        var requirement = new SecretRequirement(SecretPurpose.ApiKey, "cloud/hetzner-token", Required: true);
        var descriptor = new ToolDescriptor(requirement, Suspends: true);

        typeof(SecretRequirement).Assembly.GetName().Name.Should().Be("Tamma.Activities");
        descriptor.RequiredSecret.Should().Be(requirement);
        descriptor.RequiredSecret!.Purpose.Should().Be(SecretPurpose.ApiKey);
        descriptor.Suspends.Should().BeTrue();
    }

    [Test]
    public void ProjectReferences_PreserveOneWayDependencyDirection()
    {
        var repoRoot = FindTammaElsaRoot();

        var coreRefs = ReadProjectReferences(Path.Combine(repoRoot, "src", "Tamma.Core", "Tamma.Core.csproj"));
        coreRefs.Should().BeEmpty("Tamma.Core must remain a leaf assembly with zero ProjectReferences");

        var activitiesRefs = ReadProjectReferences(Path.Combine(repoRoot, "src", "Tamma.Activities", "Tamma.Activities.csproj"));
        activitiesRefs.Should().Contain(new[] { "Tamma.Core.csproj", "Tamma.Data.csproj" });
        activitiesRefs.Should().NotContain("Tamma.Api.csproj", "Tamma.Activities must never reference Tamma.Api");
        activitiesRefs.Should().NotContain("Tamma.ElsaServer.csproj", "Tamma.Activities must never reference Tamma.ElsaServer");
    }

    private static string FindTammaElsaRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "Tamma.sln")))
                return dir.FullName;
            dir = dir.Parent;
        }

        throw new InvalidOperationException("Could not locate Tamma.sln from test base directory.");
    }

    private static string[] ReadProjectReferences(string csprojPath)
    {
        var doc = XDocument.Load(csprojPath);
        return doc.Descendants("ProjectReference")
            .Where(e => !string.Equals(
                (string?)e.Attribute("OutputItemType"),
                "Analyzer",
                StringComparison.OrdinalIgnoreCase))
            .Select(e => Path.GetFileName(((string?)e.Attribute("Include") ?? string.Empty).Replace('\\', '/')))
            .ToArray();
    }
}
