using FluentAssertions;
using Microsoft.Extensions.Logging;
using Moq;
using NUnit.Framework;
using Tamma.Activities.LlmCall.Models;
using Tamma.Activities.LlmCall.Tools;
using Tamma.Api.Services.Secrets;

namespace Tamma.Activities.Tests.LlmCall.Tools;

/// <summary>
/// Story 42-1 AC3 &amp; AC4 / D4 &amp; D5: verifies thread-safe dynamic <c>Register</c> / <c>Unregister</c>,
/// immutable DI-seeded built-in protection, duplicate rejection, principal-scoped refusal, and
/// race-free concurrent access.
/// </summary>
[TestFixture]
public class ToolExecutorRegistryDynamicTests
{
    private Mock<ILogger<ToolExecutorRegistry>> _loggerMock = null!;

    [SetUp]
    public void SetUp()
    {
        _loggerMock = new Mock<ILogger<ToolExecutorRegistry>>();
    }

    [Test]
    public void Register_ThenUnregister_AddsAndRemovesToolAtRuntimeWithoutRestart()
    {
        var builtIn = new DynamicTestTool("file_read");
        var registry = new ToolExecutorRegistry(new IToolExecutor[] { builtIn }, _loggerMock.Object);
        var dynamicTool = new DynamicTestTool(
            "mcp__github__list_issues",
            new ToolDescriptor(new SecretRequirement(SecretPurpose.ApiKey, "mcp/github", true), Suspends: false));

        registry.Register(dynamicTool);

        registry.GetExecutor("mcp__github__list_issues").Should().BeSameAs(dynamicTool);
        registry.GetExecutor("MCP__GITHUB__LIST_ISSUES").Should().BeSameAs(dynamicTool);
        registry.GetAll().Select(t => t.ToolName).Should().BeEquivalentTo(new[] { "file_read", "mcp__github__list_issues" });
        registry.GetAllowed(new[] { "mcp__github__list_issues" }).Should().ContainSingle()
            .Which.Should().BeSameAs(dynamicTool);

        registry.Unregister("MCP__GITHUB__LIST_ISSUES").Should().BeTrue();

        registry.GetExecutor("mcp__github__list_issues").Should().BeNull();
        registry.GetAll().Select(t => t.ToolName).Should().BeEquivalentTo(new[] { "file_read" });
        registry.Unregister("mcp__github__list_issues").Should().BeFalse();
    }

    [Test]
    public void Register_DuplicateDynamicName_RejectsByDefault_AndSucceedsAfterUnregister()
    {
        var registry = new ToolExecutorRegistry(Array.Empty<IToolExecutor>(), _loggerMock.Object);
        var first = new DynamicTestTool("mcp__srv__tool");
        var replacement = new DynamicTestTool("MCP__SRV__TOOL");

        registry.Register(first);

        Action duplicate = () => registry.Register(replacement);
        duplicate.Should().Throw<InvalidOperationException>()
            .WithMessage("*Unregister*");

        registry.Unregister("mcp__srv__tool").Should().BeTrue();
        registry.Register(replacement);

        registry.GetExecutor("mcp__srv__tool").Should().BeSameAs(replacement);
    }

    [Test]
    public void Register_DuplicateOfBuiltIn_IsRejected()
    {
        var builtIn = new DynamicTestTool("file_read");
        var registry = new ToolExecutorRegistry(new IToolExecutor[] { builtIn }, _loggerMock.Object);

        Action act = () => registry.Register(new DynamicTestTool("FILE_READ"));

        act.Should().Throw<InvalidOperationException>()
            .WithMessage("*built-in*");
        registry.GetExecutor("file_read").Should().BeSameAs(builtIn);
    }

    [Test]
    public void Unregister_BuiltInDiSeededTool_IsRefused()
    {
        var builtIn = new DynamicTestTool("file_read");
        var registry = new ToolExecutorRegistry(new IToolExecutor[] { builtIn }, _loggerMock.Object);

        Action act = () => registry.Unregister("FILE_READ");

        act.Should().Throw<InvalidOperationException>()
            .WithMessage("*built-in*");
        registry.GetExecutor("file_read").Should().BeSameAs(builtIn);
    }

    [Test]
    public void Register_PrincipalScopedTool_ThrowsTypedExceptionNamingStory42_6PartB()
    {
        var registry = new ToolExecutorRegistry(Array.Empty<IToolExecutor>(), _loggerMock.Object);
        var principalBound = new PrincipalBoundTestTool("tenant_secret_tool");

        Action act = () => registry.Register(principalBound);

        act.Should().Throw<PrincipalScopedToolRegistrationException>()
            .WithMessage("*42-6 Part B*")
            .Which.ToolName.Should().Be("tenant_secret_tool");

        registry.GetExecutor("tenant_secret_tool").Should().BeNull();
        registry.GetAll().Should().BeEmpty();
    }

    [Test]
    public void Interface_ExposesNoPrincipalScopedRegistrationOverload()
    {
        var registerMethods = typeof(IToolExecutorRegistry)
            .GetMethods()
            .Where(m => m.Name == nameof(IToolExecutorRegistry.Register))
            .ToArray();

        registerMethods.Should().ContainSingle();
        registerMethods[0].GetParameters().Select(p => p.ParameterType)
            .Should().Equal(typeof(IToolExecutor));
    }

    [Test]
    public void Register_AndUnregister_ValidateNullAndBlankInputs()
    {
        var registry = new ToolExecutorRegistry(Array.Empty<IToolExecutor>(), _loggerMock.Object);

        ((Action)(() => registry.Register(null!))).Should().Throw<ArgumentNullException>();
        ((Action)(() => registry.Register(new DynamicTestTool("   ")))).Should().Throw<ArgumentException>();
        ((Action)(() => registry.Unregister(""))).Should().Throw<ArgumentException>();
        ((Action)(() => registry.Unregister("   "))).Should().Throw<ArgumentException>();
    }

    [Test]
    public async Task Concurrent_RegisterUnregisterGetAll_IsRaceFreeWithConsistentSnapshots()
    {
        var builtIns = new IToolExecutor[]
        {
            new DynamicTestTool("file_read"),
            new DynamicTestTool("file_write"),
            new DynamicTestTool("search_code"),
        };
        var registry = new ToolExecutorRegistry(builtIns, _loggerMock.Object);

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        const int workerCount = 8;
        const int iterationsPerWorker = 100;

        var writers = Enumerable.Range(0, workerCount).Select(workerId => Task.Run(() =>
        {
            for (var i = 0; i < iterationsPerWorker && !cts.IsCancellationRequested; i++)
            {
                var name = $"mcp__worker{workerId}__tool{i % 5}";
                var tool = new DynamicTestTool(name);
                registry.Register(tool);
                registry.GetExecutor(name).Should().NotBeNull();
                registry.Unregister(name).Should().BeTrue();
            }
        }, cts.Token));

        var readers = Enumerable.Range(0, 4).Select(_ => Task.Run(() =>
        {
            for (var i = 0; i < iterationsPerWorker * 2 && !cts.IsCancellationRequested; i++)
            {
                var all = registry.GetAll();
                var names = all.Select(t => t.ToolName).ToList();

                names.Should().Contain(new[] { "file_read", "file_write", "search_code" });
                names.Select(n => n.ToLowerInvariant()).Should().OnlyHaveUniqueItems();

                var allowed = registry.GetAllowed(new[] { "file_read", "mcp__worker0__tool0" });
                allowed.Should().Contain(t => t.ToolName == "file_read");
            }
        }, cts.Token));

        await Task.WhenAll(writers.Concat(readers));

        registry.GetAll().Select(t => t.ToolName)
            .Should().BeEquivalentTo(new[] { "file_read", "file_write", "search_code" });
    }

    private sealed class DynamicTestTool(string name, ToolDescriptor? descriptor = null) : IToolExecutor
    {
        public string ToolName => name;
        public string Description => $"Dynamic test tool {name}";
        public Dictionary<string, object> InputSchema => new();
        public ToolDescriptor Descriptor => descriptor ?? ToolDescriptor.Default;

        public Task<ToolExecutionResult> ExecuteAsync(
            string toolCallId, string argumentsJson, CancellationToken cancellationToken = default) =>
            Task.FromResult(new ToolExecutionResult(toolCallId, name, true, "ok", 1));
    }

    private sealed class PrincipalBoundTestTool(string name) : IPrincipalScopedToolExecutor
    {
        public string ToolName => name;
        public string Description => $"Principal-bound tool {name}";
        public Dictionary<string, object> InputSchema => new();
        public ToolDescriptor Descriptor => ToolDescriptor.Default;

        public Task<ToolExecutionResult> ExecuteAsync(
            string toolCallId, string argumentsJson, CancellationToken cancellationToken = default) =>
            Task.FromResult(new ToolExecutionResult(toolCallId, name, true, "ok", 1));
    }
}
