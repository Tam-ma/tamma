using FluentAssertions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Moq;
using NUnit.Framework;
using Tamma.Api.Controllers;
using Tamma.Api.Models;
using Tamma.Api.Services;
using Tamma.Core.Entities;
using Tamma.Core.Enums;
using Tamma.Core.Interfaces;

namespace Tamma.Api.Tests;

[TestFixture]
public class MentorshipControllerTests
{
    private Mock<IMentorshipService> _mockMentorshipService = null!;
    private Mock<IElsaWorkflowService> _mockElsaService = null!;
    private Mock<ILogger<MentorshipController>> _mockLogger = null!;
    private MentorshipController _controller = null!;

    [SetUp]
    public void SetUp()
    {
        _mockMentorshipService = new Mock<IMentorshipService>();
        _mockElsaService = new Mock<IElsaWorkflowService>();
        _mockLogger = new Mock<ILogger<MentorshipController>>();

        _controller = new MentorshipController(
            _mockMentorshipService.Object,
            _mockElsaService.Object,
            _mockLogger.Object);
    }

    [Test]
    public async Task StartMentorship_WithValidRequest_ReturnsOkWithSessionInfo()
    {
        // Arrange
        var request = new StartMentorshipRequest
        {
            StoryId = "story-123",
            JuniorId = "junior-456"
        };

        var session = new MentorshipSession
        {
            Id = Guid.NewGuid(),
            StoryId = request.StoryId,
            JuniorId = request.JuniorId,
            CurrentState = MentorshipState.INIT_STORY_PROCESSING,
            Status = SessionStatus.Active
        };

        var workflowInstanceId = Guid.NewGuid().ToString();

        _mockMentorshipService
            .Setup(s => s.CreateSessionAsync(request.StoryId, request.JuniorId))
            .ReturnsAsync(session);

        _mockElsaService
            .Setup(s => s.StartWorkflowAsync(It.IsAny<string>(), It.IsAny<Dictionary<string, object>>()))
            .ReturnsAsync(workflowInstanceId);

        // Act
        var result = await _controller.StartMentorship(request);

        // Assert
        var okResult = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var response = okResult.Value.Should().BeOfType<MentorshipStartResponse>().Subject;

        response.SessionId.Should().Be(session.Id);
        response.WorkflowInstanceId.Should().Be(workflowInstanceId);
        response.Status.Should().Be("started");
        response.CurrentState.Should().Be("INIT_STORY_PROCESSING");

        _mockMentorshipService.Verify(
            s => s.UpdateSessionWorkflowAsync(session.Id, workflowInstanceId),
            Times.Once);
    }

    [Test]
    public async Task StartMentorship_WithMissingStoryId_ReturnsBadRequest()
    {
        // Arrange
        var request = new StartMentorshipRequest
        {
            StoryId = "",
            JuniorId = "junior-456"
        };

        // Act
        var result = await _controller.StartMentorship(request);

        // Assert
        result.Result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Test]
    public async Task StartMentorship_WithMissingJuniorId_ReturnsBadRequest()
    {
        // Arrange
        var request = new StartMentorshipRequest
        {
            StoryId = "story-123",
            JuniorId = ""
        };

        // Act
        var result = await _controller.StartMentorship(request);

        // Assert
        result.Result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Test]
    public async Task GetSession_WithExistingSession_ReturnsOk()
    {
        // Arrange
        var sessionId = Guid.NewGuid();
        var sessionDetails = new MentorshipSessionDetails
        {
            Id = sessionId,
            StoryId = "story-123",
            JuniorId = "junior-456",
            JuniorName = "Test Junior",
            StoryTitle = "Test Story",
            CurrentState = MentorshipState.MONITOR_PROGRESS,
            Status = SessionStatus.Active
        };

        _mockMentorshipService
            .Setup(s => s.GetSessionWithDetailsAsync(sessionId))
            .ReturnsAsync(sessionDetails);

        // Act
        var result = await _controller.GetSession(sessionId);

        // Assert
        var okResult = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var response = okResult.Value.Should().BeOfType<MentorshipSessionDetails>().Subject;

        response.Id.Should().Be(sessionId);
        response.CurrentState.Should().Be(MentorshipState.MONITOR_PROGRESS);
    }

    [Test]
    public async Task GetSession_WithNonExistingSession_ReturnsNotFound()
    {
        // Arrange
        var sessionId = Guid.NewGuid();

        _mockMentorshipService
            .Setup(s => s.GetSessionWithDetailsAsync(sessionId))
            .ReturnsAsync((MentorshipSessionDetails?)null);

        // Act
        var result = await _controller.GetSession(sessionId);

        // Assert
        result.Result.Should().BeOfType<NotFoundResult>();
    }

    [Test]
    public async Task PauseSession_WithExistingSession_ReturnsOk()
    {
        // Arrange
        var sessionId = Guid.NewGuid();

        _mockMentorshipService
            .Setup(s => s.PauseSessionAsync(sessionId))
            .Returns(Task.CompletedTask);

        _mockElsaService
            .Setup(s => s.PauseWorkflowAsync(sessionId.ToString()))
            .Returns(Task.CompletedTask);

        // Act
        var result = await _controller.PauseSession(sessionId);

        // Assert
        result.Should().BeOfType<OkObjectResult>();

        _mockMentorshipService.Verify(s => s.PauseSessionAsync(sessionId), Times.Once);
        _mockElsaService.Verify(s => s.PauseWorkflowAsync(sessionId.ToString()), Times.Once);
    }

    [Test]
    public async Task ResumeSession_WithExistingSession_ReturnsOk()
    {
        // Arrange
        var sessionId = Guid.NewGuid();

        _mockMentorshipService
            .Setup(s => s.ResumeSessionAsync(sessionId))
            .Returns(Task.CompletedTask);

        _mockElsaService
            .Setup(s => s.ResumeWorkflowAsync(sessionId.ToString()))
            .Returns(Task.CompletedTask);

        // Act
        var result = await _controller.ResumeSession(sessionId);

        // Assert
        result.Should().BeOfType<OkObjectResult>();

        _mockMentorshipService.Verify(s => s.ResumeSessionAsync(sessionId), Times.Once);
        _mockElsaService.Verify(s => s.ResumeWorkflowAsync(sessionId.ToString()), Times.Once);
    }

    [Test]
    public async Task CancelSession_WithExistingSession_ReturnsOk()
    {
        // Arrange
        var sessionId = Guid.NewGuid();

        _mockMentorshipService
            .Setup(s => s.CancelSessionAsync(sessionId))
            .Returns(Task.CompletedTask);

        _mockElsaService
            .Setup(s => s.CancelWorkflowAsync(sessionId.ToString()))
            .Returns(Task.CompletedTask);

        // Act
        var result = await _controller.CancelSession(sessionId);

        // Assert
        result.Should().BeOfType<OkObjectResult>();

        _mockMentorshipService.Verify(s => s.CancelSessionAsync(sessionId), Times.Once);
        _mockElsaService.Verify(s => s.CancelWorkflowAsync(sessionId.ToString()), Times.Once);
    }

    [Test]
    public async Task GetSessions_ReturnsPagedResult()
    {
        // Arrange
        var pagedResult = new PagedResult<MentorshipSessionSummary>
        {
            Items = new List<MentorshipSessionSummary>
            {
                new()
                {
                    Id = Guid.NewGuid(),
                    StoryId = "story-1",
                    JuniorId = "junior-1",
                    CurrentState = MentorshipState.MONITOR_PROGRESS,
                    Status = SessionStatus.Active
                }
            },
            TotalItems = 1,
            Page = 1,
            PageSize = 20
        };

        _mockMentorshipService
            .Setup(s => s.GetSessionsAsync(1, 20, null, null))
            .ReturnsAsync(pagedResult);

        // Act
        var result = await _controller.GetSessions();

        // Assert
        var okResult = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var response = okResult.Value.Should().BeOfType<PagedResult<MentorshipSessionSummary>>().Subject;

        response.Items.Should().HaveCount(1);
        response.TotalItems.Should().Be(1);
    }

    [Test]
    public async Task GetDashboardAnalytics_ReturnsAnalytics()
    {
        // Arrange
        var analytics = new DashboardAnalytics
        {
            ActiveSessions = 5,
            CompletedToday = 3,
            CompletedThisWeek = 15,
            AverageCompletionHours = 4.5,
            SuccessRate = 85.0
        };

        _mockMentorshipService
            .Setup(s => s.GetDashboardAnalyticsAsync())
            .ReturnsAsync(analytics);

        // Act
        var result = await _controller.GetDashboardAnalytics();

        // Assert
        var okResult = result.Result.Should().BeOfType<OkObjectResult>().Subject;
        var response = okResult.Value.Should().BeOfType<DashboardAnalytics>().Subject;

        response.ActiveSessions.Should().Be(5);
        response.SuccessRate.Should().BeApproximately(85.0, 0.1);
    }
}
