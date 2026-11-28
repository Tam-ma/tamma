using System.Text.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using NUnit.Framework;
using Tamma.Api.Services.LocalExport;

namespace Tamma.Api.Tests.Services.LocalExport;

[TestFixture]
public sealed class LocalExportSecretScrubberTests
{
    [Test]
    public void Nested_tokens_passwords_connection_strings_and_envelopes_never_survive()
    {
        var encoded = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(LocalExportTestFixture.TokenCanary));
        var json = JsonSerializer.Serialize(new
        {
            safe = "preserve-me",
            token = LocalExportTestFixture.TokenCanary,
            nested = new object[]
            {
                new { password = LocalExportTestFixture.PasswordCanary },
                new { connectionString = LocalExportTestFixture.ConnectionCanary },
                new { envelope = new { ciphertext = LocalExportTestFixture.EnvelopeCanary, nonce = "abc" } },
                new { encodedToken = encoded },
                new { freeText = $"before password={LocalExportTestFixture.PasswordCanary} after" },
                new { bearer = $"Bearer {LocalExportTestFixture.TokenCanary}" },
            },
        });

        var scrubbed = LocalExportSecretScrubber.ScrubJson(json, "test").ToJsonString();
        scrubbed.Should().Contain("preserve-me");
        scrubbed.Should().Contain("reauthorize");
        scrubbed.Should().NotContain(LocalExportTestFixture.TokenCanary)
            .And.NotContain(LocalExportTestFixture.PasswordCanary)
            .And.NotContain(LocalExportTestFixture.ConnectionCanary)
            .And.NotContain(LocalExportTestFixture.EnvelopeCanary)
            .And.NotContain(encoded);
    }

    [Test]
    public void Uri_user_info_and_common_provider_tokens_are_redacted_from_free_text()
    {
        const string githubCanary = "ghp_1234567890abcdefghij";
        var scrubbed = LocalExportSecretScrubber.ScrubText(
            $"url=https://user:{LocalExportTestFixture.PasswordCanary}@example.test token={githubCanary}");
        scrubbed.Should().NotContain(LocalExportTestFixture.PasswordCanary).And.NotContain(githubCanary);
    }

    [Test]
    public void Non_secret_token_counts_and_identifiers_are_preserved()
    {
        var scrubbed = LocalExportSecretScrubber.ScrubJson(
            "{\"maxTokens\":4096,\"tokensIn\":12,\"id\":\"event-1\",\"safe\":\"unchanged\"}", "test");
        scrubbed["maxTokens"]!.GetValue<int>().Should().Be(4096);
        scrubbed["tokensIn"]!.GetValue<int>().Should().Be(12);
        scrubbed["id"]!.GetValue<string>().Should().Be("event-1");
        scrubbed["safe"]!.GetValue<string>().Should().Be("unchanged");
    }

    [Test]
    public void Opaque_or_malformed_json_fails_closed()
    {
        var act = () => LocalExportSecretScrubber.ScrubJson("{not-json", "test");
        act.Should().Throw<LocalExportException>()
            .Where(ex => ex.Code == "EXPORT.SCRUB.INVALID_JSON");
    }

    [Test]
    public void Secret_object_keys_are_markers_even_for_null_or_nested_values()
    {
        var scrubbed = LocalExportSecretScrubber.ScrubJson(
            "{\"clientSecret\":null,\"credentials\":{\"name\":\"raw-reference\"}}", "test");
        scrubbed["clientSecret"]!["$tamma"]!.GetValue<string>().Should().Be("reauthorize");
        scrubbed["credentials"]!["$tamma"]!.GetValue<string>().Should().Be("reauthorize");
        scrubbed.ToJsonString().Should().NotContain("raw-reference");
    }
}
