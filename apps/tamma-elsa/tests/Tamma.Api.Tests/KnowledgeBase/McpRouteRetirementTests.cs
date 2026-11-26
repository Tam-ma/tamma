using System.Net;
using System.Net.Http.Json;
using System.Text.RegularExpressions;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Moq;
using NUnit.Framework;
using Tamma.Api.Services.KnowledgeBase;

namespace Tamma.Api.Tests.KnowledgeBase;

/// <summary>
/// Story 42-6 Part A (AC A1, A2, A3 / D1, D2):
/// <list type="bullet">
///   <item><b>A1:</b> <c>GET /api/kb/mcp/tools</c> and <c>POST /api/kb/mcp/tools/invoke</c> return
///     404, and an <see cref="EndpointDataSource"/> route-inventory invariant fails if any mapped
///     route contains both <c>mcp</c> and a tool-invoking segment (<c>tools</c>, <c>invoke</c>,
///     <c>execute</c>, <c>call</c>).</item>
///   <item><b>A2:</b> <see cref="IIntelligenceHttpClient"/> and <see cref="IntelligenceHttpClient"/>
///     expose no <c>InvokeMcpTool*</c> or <c>ListMcpTools*</c> member, and <c>McpInvokeRequest</c>
///     is gone.</item>
///   <item><b>A3:</b> <c>packages/dashboard/src</c> carries zero remaining <c>mcpApi.invokeTool</c>
///     or <c>mcpApi.listTools</c> call sites (surviving 6 admin routes are additionally covered by
///     <see cref="KbEndpointsIntegrationTests"/>).</item>
/// </list>
/// </summary>
[TestFixture]
public class McpRouteRetirementTests
{
    private WebApplicationFactory<Program> _factory = null!;
    private HttpClient _client = null!;

    private static readonly string[] ForbiddenMcpToolSegments =
    [
        "tools",
        "invoke",
        "execute",
        "call",
    ];

    [OneTimeSetUp]
    public void OneTimeSetUp()
    {
        _factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Development");
            builder.ConfigureServices(services =>
            {
                var mockClient = new Mock<IIntelligenceHttpClient>();
                mockClient.Setup(c => c.ListMcpServersAsync(It.IsAny<CancellationToken>()))
                    .ReturnsAsync(Array.Empty<object>());
                services.RemoveAll<IIntelligenceHttpClient>();
                services.AddSingleton(mockClient.Object);
            });
        });

        _client = _factory.CreateClient();
    }

    [OneTimeTearDown]
    public void OneTimeTearDown()
    {
        _client.Dispose();
        _factory.Dispose();
    }

    [Test]
    public async Task A1_RetiredMcpToolRoutes_Return404()
    {
        var getTools = await _client.GetAsync("/api/kb/mcp/tools");
        getTools.StatusCode.Should().Be(HttpStatusCode.NotFound,
            "GET /api/kb/mcp/tools was retired by Story 42-6 Part A");

        var invokeTool = await _client.PostAsJsonAsync(
            "/api/kb/mcp/tools/invoke",
            new { serverName = "github", toolName = "read_file", arguments = new { } });
        invokeTool.StatusCode.Should().Be(HttpStatusCode.NotFound,
            "POST /api/kb/mcp/tools/invoke was retired by Story 42-6 Part A");
    }

    [Test]
    public void A1_RouteInventoryInvariant_NoMappedRouteContainsBothMcpAndToolInvokingSegment()
    {
        var dataSource = _factory.Services.GetRequiredService<EndpointDataSource>();
        var routePatterns = dataSource.Endpoints
            .OfType<RouteEndpoint>()
            .Select(e => e.RoutePattern.RawText ?? string.Empty)
            .ToArray();

        routePatterns.Should().Contain(
            p => p.Contains("/api/kb/mcp/servers", StringComparison.OrdinalIgnoreCase),
            "the 6 surviving sidecar-KB admin routes must still be mapped");

        var offending = new List<string>();
        foreach (var pattern in routePatterns)
        {
            var segments = pattern.Split('/', StringSplitOptions.RemoveEmptyEntries);
            var hasMcp = segments.Any(s => string.Equals(s, "mcp", StringComparison.OrdinalIgnoreCase));
            if (!hasMcp)
                continue;

            var hasToolSegment = segments.Any(s =>
                ForbiddenMcpToolSegments.Any(f => string.Equals(s, f, StringComparison.OrdinalIgnoreCase)));
            if (hasToolSegment)
                offending.Add(pattern);
        }

        offending.Should().BeEmpty(
            "Story 42-6 Part A invariant: no mapped HTTP route may expose tool invocation under an MCP prefix " +
            "(especially because /api/kb/mcp/* is AllowAnonymous in dev-without-JWT mode)");
    }

    [Test]
    public void A2_IntelligenceHttpClient_ExposesNoMcpToolMembers_AndMcpInvokeRequestIsDeleted()
    {
        var forbiddenInterfaceMembers = typeof(IIntelligenceHttpClient)
            .GetMembers()
            .Where(m => m.Name.Contains("McpTool", StringComparison.OrdinalIgnoreCase))
            .Select(m => m.Name)
            .ToArray();

        forbiddenInterfaceMembers.Should().BeEmpty(
            "IIntelligenceHttpClient must not expose InvokeMcpTool* or ListMcpTools* after Story 42-6 Part A");

        var forbiddenImplMembers = typeof(IntelligenceHttpClient)
            .GetMembers()
            .Where(m => m.Name.Contains("McpTool", StringComparison.OrdinalIgnoreCase))
            .Select(m => m.Name)
            .ToArray();

        forbiddenImplMembers.Should().BeEmpty(
            "IntelligenceHttpClient must not retain MCP tool forwarders");

        typeof(IIntelligenceHttpClient).Assembly.GetTypes()
            .Where(t => t.Name == "McpInvokeRequest")
            .Should().BeEmpty("McpInvokeRequest DTO must be deleted with POST /api/kb/mcp/tools/invoke");
    }

    [Test]
    public void A3_DashboardSource_HasNoRemainingMcpApiToolCallSites()
    {
        var repoRoot = FindRepoRoot();
        var dashboardSrc = Path.Combine(repoRoot, "packages", "dashboard", "src");
        Directory.Exists(dashboardSrc).Should().BeTrue();

        var forbidden = new Regex(@"mcpApi\.(invokeTool|listTools)\b", RegexOptions.Compiled);
        var hits = new List<string>();

        foreach (var file in Directory.EnumerateFiles(dashboardSrc, "*.*", SearchOption.AllDirectories)
                     .Where(f => f.EndsWith(".ts", StringComparison.OrdinalIgnoreCase)
                                 || f.EndsWith(".tsx", StringComparison.OrdinalIgnoreCase)))
        {
            var content = File.ReadAllText(file);
            if (forbidden.IsMatch(content))
                hits.Add(Path.GetRelativePath(repoRoot, file));
        }

        hits.Should().BeEmpty(
            "Story 42-6 Part A AC A3: dashboard must have no remaining mcpApi.invokeTool or mcpApi.listTools call sites");
    }

    private static string FindRepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (Directory.Exists(Path.Combine(dir.FullName, "packages", "dashboard")))
                return dir.FullName;
            dir = dir.Parent;
        }

        throw new InvalidOperationException("Could not locate repository root containing packages/dashboard.");
    }
}
