using System.Text.Json;
using FluentAssertions;
using Moq;
using NUnit.Framework;
using Tamma.Api.Services.Chat;
using Tamma.Core.Documents.Channels;
using Tamma.Core.Redaction;
using Tamma.Data.Entities;
using Tamma.Data.Repositories;

namespace Tamma.Api.Tests.Chat;

[TestFixture]
public sealed class ChatTranscriptRecorderTests
{
    [Test]
    public async Task RecordUserTurn_and_RecordAgentReply_stamp_full_tags_and_redact_secrets()
    {
        var appended = new List<DomainEvent>();
        var events = new Mock<IEventRepository>(MockBehavior.Strict);
        events.Setup(e => e.AppendAsync(It.IsAny<DomainEvent>()))
            .Callback<DomainEvent>(evt => appended.Add(evt))
            .ReturnsAsync((DomainEvent evt) => evt);

        var recorder = new EventStoreChatTranscriptRecorder(events.Object);
        var tenantId = Guid.NewGuid();
        var userId = Guid.NewGuid();
        var conversationId = Guid.NewGuid();
        var ctx = new ChatTurnContext(tenantId, userId, conversationId, IssueId: "acme/web#42");

        var turnId = await recorder.RecordUserTurnAsync(
            ctx,
            "Please check repo using token sk-ant-api03-verysecretkey12345");
        await recorder.RecordAgentReplyAsync(
            ctx,
            turnId,
            "Checked issue #42; never echo Bearer my-super-secret-bearer-token-9999");

        turnId.Should().NotBe(Guid.Empty);
        appended.Should().HaveCount(2);

        var received = appended[0];
        received.Type.Should().Be(ChatEvents.MessageReceived);
        received.TenantId.Should().Be(tenantId);
        received.Data.Should().NotContain("sk-ant-api03-verysecretkey12345");
        received.Data.Should().Contain(CredentialRedactor.Placeholder);

        using (var tags = JsonDocument.Parse(received.Tags))
        {
            tags.RootElement.GetProperty("userId").GetString().Should().Be(userId.ToString("D"));
            tags.RootElement.GetProperty("tenantId").GetString().Should().Be(tenantId.ToString("D"));
            tags.RootElement.GetProperty("conversationId").GetString().Should().Be(conversationId.ToString("D"));
            tags.RootElement.GetProperty("correlationId").GetString().Should().Be(conversationId.ToString("D"));
            tags.RootElement.GetProperty("turnId").GetString().Should().Be(turnId.ToString("D"));
            tags.RootElement.GetProperty("issueId").GetString().Should().Be("acme/web#42");
        }

        var sent = appended[1];
        sent.Type.Should().Be(ChatEvents.MessageSent);
        sent.Data.Should().NotContain("my-super-secret-bearer-token-9999");
        sent.Data.Should().Contain(CredentialRedactor.Placeholder);

        using (var tags = JsonDocument.Parse(sent.Tags))
        {
            tags.RootElement.GetProperty("turnId").GetString().Should().Be(turnId.ToString("D"));
            tags.RootElement.GetProperty("correlationId").GetString().Should().Be(conversationId.ToString("D"));
        }
    }

    [Test]
    public async Task Recorder_implements_IChatTranscriptRecorder_and_fails_loud_on_append_error()
    {
        var events = new Mock<IEventRepository>(MockBehavior.Strict);
        events.Setup(e => e.AppendAsync(It.IsAny<DomainEvent>()))
            .ThrowsAsync(new InvalidOperationException("event store offline"));

        var recorder = new EventStoreChatTranscriptRecorder(events.Object);
        var msg = new AgentConversationMessage(Guid.NewGuid(), Guid.NewGuid(), "user->agent", "hello");

        var actReceived = () => recorder.RecordReceivedAsync(Guid.NewGuid(), msg.UserId, msg);
        await actReceived.Should().ThrowAsync<InvalidOperationException>().WithMessage("*event store offline*");

        var reply = msg with { Direction = "agent->user", Text = "reply" };
        var actSent = () => recorder.RecordSentAsync(Guid.NewGuid(), reply.UserId, reply);
        await actSent.Should().ThrowAsync<InvalidOperationException>().WithMessage("*event store offline*");
    }
}
