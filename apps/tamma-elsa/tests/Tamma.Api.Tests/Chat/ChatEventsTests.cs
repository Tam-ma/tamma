using FluentAssertions;
using NUnit.Framework;
using Tamma.Api.Services.Chat;
using Tamma.Core.Redaction;

namespace Tamma.Api.Tests.Chat;

[TestFixture]
public sealed class ChatEventsTests
{
    [Test]
    public void ChatEvents_constants_are_exact_three_segment_names()
    {
        ChatEvents.MessageReceived.Should().Be("CHAT.MESSAGE.RECEIVED");
        ChatEvents.MessageSent.Should().Be("CHAT.MESSAGE.SENT");
        ChatEvents.WorkflowInitiated.Should().Be("CHAT.WORKFLOW.INITIATED");
        ChatEvents.WorkflowRefused.Should().Be("CHAT.WORKFLOW.REFUSED");
    }

    [Test]
    public void CredentialRedactor_single_arg_matches_MaxLength_overload_byte_for_byte()
    {
        var samples = new[]
        {
            null,
            string.Empty,
            "normal error text",
            "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig",
            "postgres://admin:supersecret@db.internal:5432/tamma",
            "line1\r\nline2\twith key sk-ant-api03-1234567890abcdef",
            new string('a', CredentialRedactor.MaxLength + 500),
        };

        foreach (var sample in samples)
        {
            CredentialRedactor.Clean(sample)
                .Should().Be(CredentialRedactor.Clean(sample, CredentialRedactor.MaxLength));
        }

        CredentialRedactor.Clean(new string('x', 2000)).Length.Should().Be(CredentialRedactor.MaxLength);
    }

    [Test]
    public void CredentialRedactor_chat_overload_preserves_long_prose_and_redacts_api_keys()
    {
        var longProse = new string('w', 2500) + " my key is sk-ant-api03-secretvalue123456789 end";
        var cleaned = CredentialRedactor.Clean(longProse, ChatEvents.ChatRedactionMaxLength);

        cleaned.Length.Should().BeGreaterThan(2500);
        cleaned.Should().NotContain("sk-ant-api03-secretvalue123456789");
        cleaned.Should().Contain(CredentialRedactor.Placeholder);
    }

    [Test]
    public void CredentialRedactor_negative_maxLength_throws()
    {
        var act = () => CredentialRedactor.Clean("hello", -1);
        act.Should().Throw<ArgumentOutOfRangeException>();
    }
}
