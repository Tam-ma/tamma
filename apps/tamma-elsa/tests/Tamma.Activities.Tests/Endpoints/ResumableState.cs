using Elsa.Workflows.Models;
using Elsa.Workflows.Runtime;
using Elsa.Workflows.Runtime.Entities;
using Elsa.Workflows.State;
using Moq;

namespace Tamma.Activities.Tests.Endpoints;

/// <summary>
/// For endpoint unit tests with a mocked <see cref="IWorkflowClient"/>: makes the instance
/// state the client exports hold every bookmark the test created, with its activity, so
/// <c>ResumeGuard</c> sees a stored state that can be resumed.
/// </summary>
internal static class ResumableState
{
    private static readonly List<StoredBookmark> Created = new();

    /// <summary>Call from SetUp, right after creating the client mock.</summary>
    public static void Arrange(Mock<IWorkflowClient> client)
    {
        lock (Created) Created.Clear();
        client.Setup(c => c.ExportStateAsync(It.IsAny<CancellationToken>())).ReturnsAsync(() => Build());
    }

    /// <summary>Records a bookmark the test stores, and returns it.</summary>
    public static StoredBookmark Register(StoredBookmark bookmark)
    {
        lock (Created) Created.Add(bookmark);
        return bookmark;
    }

    private static WorkflowState Build()
    {
        var state = new WorkflowState();
        lock (Created)
            foreach (var b in Created)
            {
                var activity = "activity-of-" + b.Id;
                state.Bookmarks.Add(new Bookmark(b.Id, b.Name ?? "n", "h", null, "a", "node", activity, DateTimeOffset.UtcNow));
                state.ActivityExecutionContexts.Add(new ActivityExecutionContextState { Id = activity });
            }
        return state;
    }
}
