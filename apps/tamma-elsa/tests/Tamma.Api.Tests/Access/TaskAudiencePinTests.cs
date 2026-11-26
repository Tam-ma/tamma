using System.Reflection;
using FluentAssertions;
using NUnit.Framework;
using Tamma.Api.Services.Access;
using Tamma.Data.Repositories;

namespace Tamma.Api.Tests.Access;

/// <summary>
/// Story 39-20 (AC3 / D11) — build-time architecture pin asserting:
/// <list type="number">
///   <item>There is exactly ONE non-obsolete production implementation of
///     <see cref="ITaskAudienceResolver"/> in <c>Tamma.Api</c>
///     (<see cref="TaskAudienceResolver"/>).</item>
///   <item>Raw team/grant repositories (<see cref="ITeamRepository"/>,
///     <see cref="IRepoAccessRepository"/>) appear ONLY in the allowlisted
///     constructors (<see cref="TaskAudienceResolver"/>,
///     <see cref="TeamService"/>, <see cref="RepoAccessService"/>) so no hub,
///     endpoint, or orchestrator can bypass the single visibility predicate.</item>
/// </list>
/// </summary>
[TestFixture]
public class TaskAudiencePinTests
{
    private static readonly HashSet<Type> AllowedRepositoryConsumers =
    [
        typeof(TaskAudienceResolver),
        typeof(TeamService),
        typeof(RepoAccessService),
    ];

    [Test]
    public void Tamma_Api_has_exactly_one_production_ITaskAudienceResolver_implementation()
    {
        var apiAssembly = typeof(TaskAudienceResolver).Assembly;
        var implementations = apiAssembly.GetTypes()
            .Where(t => !t.IsInterface && !t.IsAbstract && typeof(ITaskAudienceResolver).IsAssignableFrom(t))
            .Where(t => t.GetCustomAttribute<ObsoleteAttribute>() is null)
            .ToList();

        implementations.Should().Equal([typeof(TaskAudienceResolver)],
            "Story 39-20 D11: exactly one production ITaskAudienceResolver implementation may exist in Tamma.Api");
    }

    [Test]
    public void Team_and_repo_access_repositories_are_confined_to_allowlisted_constructors()
    {
        var apiAssembly = typeof(TaskAudienceResolver).Assembly;
        var forbiddenTypes = new[] { typeof(ITeamRepository), typeof(IRepoAccessRepository) };

        var violators = new List<string>();
        foreach (var type in apiAssembly.GetTypes().Where(t => !t.IsInterface && !t.IsAbstract))
        {
            if (AllowedRepositoryConsumers.Contains(type))
                continue;

            foreach (var ctor in type.GetConstructors(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance))
            {
                var badParams = ctor.GetParameters()
                    .Where(p => forbiddenTypes.Contains(p.ParameterType))
                    .Select(p => p.ParameterType.Name)
                    .ToList();
                if (badParams.Count > 0)
                    violators.Add($"{type.FullName}({string.Join(", ", badParams)})");
            }
        }

        violators.Should().BeEmpty(
            "Story 39-20 D11: consumers must route through ITaskAudienceResolver / IRepoAccessEvaluator / TeamService / RepoAccessService, never query raw grant tables directly");
    }
}
