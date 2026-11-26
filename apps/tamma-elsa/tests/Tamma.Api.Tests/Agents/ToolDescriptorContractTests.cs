using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using NUnit.Framework;
using Tamma.Activities.LlmCall.Tools;
using Tamma.Api.Services.AcceptanceRules;
using Tamma.Core.Documents.Policy;

namespace Tamma.Api.Tests.Agents;

/// <summary>
/// Story 42-1 AC2, AC4, AC6 / D2: verifies that <see cref="IToolExecutor.Descriptor"/> is a plain
/// abstract interface member (compiler-enforced — no DIM reflection drift test is needed or written),
/// that all 7 production executors declare <c>(RequiredSecret: null, Suspends: false)</c>, that
/// <see cref="GetAcceptanceRulesTool"/> is principal-scoped and rejected by dynamic registration,
/// and that <c>ResolveToolsActivity</c> remains absent.
/// </summary>
[TestFixture]
public class ToolDescriptorContractTests
{
    [Test]
    public void Descriptor_IsPlainAbstractInterfaceMember_WithOnlyCapabilityFields()
    {
        var prop = typeof(IToolExecutor).GetProperty(nameof(IToolExecutor.Descriptor));
        prop.Should().NotBeNull();
        prop!.GetMethod!.IsAbstract.Should().BeTrue(
            "Descriptor is a plain abstract member, not a default interface member (Story 42-1 D2)");

        var descriptorProps = typeof(ToolDescriptor).GetProperties()
            .Select(p => p.Name)
            .ToArray();
        descriptorProps.Should().BeEquivalentTo(new[]
        {
            nameof(ToolDescriptor.RequiredSecret),
            nameof(ToolDescriptor.Suspends),
        });

        var activitiesTypes = typeof(IToolExecutor).Assembly.GetTypes().Select(t => t.Name).ToHashSet();
        activitiesTypes.Should().NotContain("ToolCategory", "Category was absorbed by Epic 43");
        activitiesTypes.Should().NotContain("ToolPermissionClass", "PermissionClass became Tamma.Core.Actions.ActionRisk");
    }

    [Test]
    public void AllSevenProductionExecutors_DeclareExpectedCapabilityDescriptors()
    {
        var config = new ConfigurationBuilder().Build();
        var rulesResolver = new Mock<IAcceptanceRulesResolver>();

        IToolExecutor[] executors =
        [
            new FileReadTool(NullLogger<FileReadTool>.Instance, config),
            new FileWriteTool(NullLogger<FileWriteTool>.Instance, config),
            new SearchCodeTool(NullLogger<SearchCodeTool>.Instance, config),
            new ShellExecuteTool(NullLogger<ShellExecuteTool>.Instance, config),
            new GitOperationsTool(NullLogger<GitOperationsTool>.Instance, config),
            new RunTestsTool(NullLogger<RunTestsTool>.Instance, config),
            new GetAcceptanceRulesTool(rulesResolver.Object, userId: Guid.NewGuid(), tenantId: null),
        ];

        executors.Should().HaveCount(7);
        foreach (var executor in executors)
        {
            executor.Descriptor.Should().NotBeNull();
            executor.Descriptor.RequiredSecret.Should().BeNull($"built-in '{executor.ToolName}' uses no external secret");
            executor.Descriptor.Suspends.Should().BeFalse($"built-in '{executor.ToolName}' does not suspend");
        }
    }

    [Test]
    public void Coalesce_NullDescriptorFromUnconfiguredMock_ReturnsDefaultCapabilityDescriptor()
    {
        var unconfiguredMock = new Mock<IToolExecutor>();

        unconfiguredMock.Object.Descriptor.Should().BeNull();

        var coalesced = ToolDescriptor.Coalesce(unconfiguredMock.Object.Descriptor);
        coalesced.RequiredSecret.Should().BeNull();
        coalesced.Suspends.Should().BeFalse();
    }

    [Test]
    public void GetAcceptanceRulesTool_IsPrincipalScoped_AndRejectedByDynamicRegister()
    {
        var rulesResolver = new Mock<IAcceptanceRulesResolver>();
        var tool = new GetAcceptanceRulesTool(rulesResolver.Object, userId: null, tenantId: Guid.NewGuid());
        var registry = new ToolExecutorRegistry(
            Array.Empty<IToolExecutor>(), NullLogger<ToolExecutorRegistry>.Instance);

        tool.Should().BeAssignableTo<IPrincipalScopedToolExecutor>();

        Action register = () => registry.Register(tool);
        register.Should().Throw<PrincipalScopedToolRegistrationException>()
            .WithMessage("*42-6 Part B*")
            .Which.ToolName.Should().Be("get_acceptance_rules");

        registry.GetExecutor("get_acceptance_rules").Should().BeNull();
    }

    [Test]
    public void Precondition_ResolveToolsActivity_RemainsAbsent()
    {
        var assemblies = new[]
        {
            typeof(IToolExecutor).Assembly,
            typeof(GetAcceptanceRulesTool).Assembly,
        };

        assemblies.SelectMany(a => a.GetTypes())
            .Where(t => t.Name == "ResolveToolsActivity")
            .Should().BeEmpty("Story 43-0 deleted ResolveToolsActivity");
    }
}
