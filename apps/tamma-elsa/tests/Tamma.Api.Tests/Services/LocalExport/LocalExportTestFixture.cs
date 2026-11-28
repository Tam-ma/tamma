using System.Formats.Tar;
using System.IO.Compression;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Tamma.Api.Services.LocalExport;

namespace Tamma.Api.Tests.Services.LocalExport;

internal static class LocalExportTestFixture
{
    public const string TokenCanary = "tamma-token-CANARY-7f29a4";
    public const string PasswordCanary = "tamma-password-CANARY-18c63b";
    public const string ConnectionCanary = "Host=localhost;Username=local;Password=tamma-connection-CANARY-e741";
    public const string EnvelopeCanary = "tamma-envelope-CANARY-99e410";

    public static readonly Guid UserId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid TenantId = Guid.Parse("22222222-2222-2222-2222-222222222222");

    public static LocalExportSigner Signer(byte fill = 7) =>
        LocalExportSigner.FromSeed(Enumerable.Repeat(fill, 32).ToArray());

    public static LocalExportCapture Capture()
    {
        var eventId = Guid.Parse("33333333-3333-3333-3333-333333333333");
        var documentId = Guid.Parse("44444444-4444-4444-4444-444444444444");
        var definitionId = Guid.Parse("55555555-5555-5555-5555-555555555555");
        var instanceId = Guid.Parse("66666666-6666-6666-6666-666666666666");
        var authorizationId = Guid.Parse("77777777-7777-7777-7777-777777777777");
        var providerId = Guid.Parse("88888888-8888-8888-8888-888888888888");
        return new LocalExportCapture(
            "test-revision",
            ["20261126000000_ControlPlane"],
            ["20261126000001_Tenant"],
            "events=1;documents=1;workflows=1;assignments=1;providers=1",
            new JsonObject
            {
                ["id"] = UserId.ToString(),
                ["email"] = "local@example.test",
                ["settings"] = LocalExportSecretScrubber.ScrubJson(
                    $"{{\"theme\":\"dark\",\"nested\":{{\"token\":\"{TokenCanary}\"}}}}", "Settings"),
            },
            new JsonObject
            {
                ["id"] = TenantId.ToString(),
                ["name"] = "Local workspace",
                ["slug"] = "u-local",
                ["type"] = "personal",
                ["ownerId"] = UserId.ToString(),
            },
            [
                Dataset("tenant.domain_events", eventId, new JsonObject
                {
                    ["sequenceNumber"] = 1,
                    ["type"] = "DOCUMENT.CREATED",
                    ["data"] = LocalExportSecretScrubber.ScrubJson(
                        $"{{\"safe\":\"preserved\",\"nested\":[{{\"password\":\"{PasswordCanary}\"}}],\"connection\":\"{ConnectionCanary}\"}}",
                        "Data"),
                    ["createdAt"] = "2026-11-28T00:00:00.0000000Z",
                }),
                Dataset("tenant.documents", documentId, new JsonObject
                {
                    ["issueId"] = "issue-47",
                    ["revision"] = 1,
                    ["correlatingEventId"] = eventId.ToString(),
                    ["bodyJson"] = new JsonObject { ["title"] = "Architecture" },
                }),
                Dataset("tenant.conventions", Guid.Parse("99999999-9999-9999-9999-999999999991"), new JsonObject { ["body"] = "Use explicit ownership." }),
                Dataset("tenant.budget_configs", Guid.Parse("99999999-9999-9999-9999-999999999992"), new JsonObject { ["limitUsd"] = 25 }),
                Dataset("tenant.prompt_overrides", Guid.Parse("99999999-9999-9999-9999-999999999993"), new JsonObject { ["template"] = "Implement safely" }),
                Dataset("tenant.workflow_definitions", definitionId, new JsonObject
                {
                    ["steps"] = new JsonObject { ["value"] = new JsonArray("analyze", "implement") },
                }),
                Dataset("tenant.workflow_instances", instanceId, new JsonObject
                {
                    ["definitionId"] = definitionId.ToString(),
                    ["variables"] = LocalExportSecretScrubber.ScrubJson(
                        $"{{\"envelope\":{{\"ciphertext\":\"{EnvelopeCanary}\",\"nonce\":\"nonce\"}}}}",
                        "Variables"),
                }),
                Dataset("control_plane.action_authorizations", authorizationId, new JsonObject
                {
                    ["userId"] = UserId.ToString(),
                    ["decidedByUserId"] = UserId.ToString(),
                    ["state"] = "granted",
                }),
                Dataset("control_plane.provider_settings", providerId, new JsonObject
                {
                    ["userId"] = UserId.ToString(),
                    ["providerKey"] = "anthropic",
                    ["defaultModel"] = "claude-sonnet",
                }),
            ]);
    }

    public static async Task<Dictionary<string, byte[]>> ReadArchiveAsync(string path)
    {
        var result = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        await using var file = File.OpenRead(path);
        await using var gzip = new GZipStream(file, CompressionMode.Decompress);
        await using var tar = new TarReader(gzip);
        while (await tar.GetNextEntryAsync() is { } entry)
        {
            using var memory = new MemoryStream();
            await entry.DataStream!.CopyToAsync(memory);
            result.Add(entry.Name, memory.ToArray());
        }
        return result;
    }

    public static async Task WriteArchiveAsync(string path, IReadOnlyDictionary<string, byte[]> members)
    {
        await using var file = File.Create(path);
        await using var gzip = new GZipStream(file, CompressionLevel.Optimal, leaveOpen: true);
        await using var tar = new TarWriter(gzip, TarEntryFormat.Ustar, leaveOpen: true);
        foreach (var member in members.OrderBy(m => m.Key, StringComparer.Ordinal))
        {
            await using var input = new MemoryStream(member.Value);
            var entry = new UstarTarEntry(TarEntryType.RegularFile, member.Key)
            {
                DataStream = input,
                ModificationTime = DateTimeOffset.UnixEpoch,
            };
            await tar.WriteEntryAsync(entry);
        }
    }

    public static async Task ResignAsync(
        IDictionary<string, byte[]> members,
        LocalExportSigner signer,
        Action<JsonObject>? mutate = null)
    {
        var manifest = JsonNode.Parse(members[LocalExportFormat.ManifestMember])!.AsObject();
        mutate?.Invoke(manifest);
        var bytes = JsonSerializer.SerializeToUtf8Bytes(manifest, new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        });
        members[LocalExportFormat.ManifestMember] = bytes;
        members[LocalExportFormat.SignatureMember] = signer.Sign(bytes);
        await Task.CompletedTask;
    }

    public static async Task UpdatePayloadDigestAsync(IDictionary<string, byte[]> members, string name)
    {
        var bytes = members[name];
        await ResignAsync(members, Signer(), manifest =>
        {
            var payload = manifest["payloads"]!.AsArray()
                .Single(p => p!["name"]!.GetValue<string>() == name)!;
            payload["size"] = bytes.LongLength;
            payload["sha256"] = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes)).ToLowerInvariant();
        });
    }

    public static string AllArchiveText(IDictionary<string, byte[]> members) =>
        string.Join('\n', members.Select(m => Encoding.UTF8.GetString(m.Value)));

    private static LocalExportDataset Dataset(string name, Guid id, JsonObject fields)
    {
        fields["id"] = id.ToString();
        return new LocalExportDataset(name, [new LocalExportRow(id.ToString(), 0, fields)]);
    }
}

internal sealed class FixedTimeProvider : TimeProvider
{
    public override DateTimeOffset GetUtcNow() => new(2026, 11, 28, 1, 2, 3, TimeSpan.Zero);
}

internal sealed class StubLocalExportSource(
    Func<CancellationToken, Task<LocalExportCapture>> capture) : ILocalExportSource
{
    public Task<LocalExportCapture> CaptureAsync(CancellationToken cancellationToken) => capture(cancellationToken);
}
