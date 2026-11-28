using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Tamma.Api.Services.LocalExport;

internal static partial class LocalExportSecretScrubber
{
    private const string ReauthorizationText = "[reauthorization required]";

    public static JsonObject ScrubObject(JsonObject source, string context)
    {
        return ScrubNode(source, context) as JsonObject
            ?? throw new LocalExportException("EXPORT.SCRUB.INVALID_ROOT", "Export payload root must be an object.");
    }

    public static JsonObject ScrubJson(string json, string context)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            throw new LocalExportException("EXPORT.SCRUB.EMPTY_JSON", "Export JSON payload is empty.");
        }

        try
        {
            var node = JsonNode.Parse(json);
            return node is JsonObject obj
                ? ScrubObject(obj, context)
                : new JsonObject { ["value"] = ScrubNode(node, context) };
        }
        catch (JsonException)
        {
            throw new LocalExportException("EXPORT.SCRUB.INVALID_JSON", "Export JSON payload is malformed.");
        }
    }

    public static string ScrubText(string value)
    {
        if (LooksLikeConnectionString(value))
        {
            return ReauthorizationText;
        }

        var scrubbed = SecretAssignmentRegex().Replace(value, "$1=[redacted]");
        scrubbed = BearerRegex().Replace(scrubbed, "$1[redacted]");
        scrubbed = UserInfoRegex().Replace(scrubbed, "://[redacted]@");
        scrubbed = CommonTokenRegex().Replace(scrubbed, "[redacted]");
        return scrubbed;
    }

    private static JsonNode? ScrubNode(JsonNode? node, string context)
    {
        switch (node)
        {
            case null:
                return null;
            case JsonObject obj:
                if (IsSecretEnvelope(obj))
                {
                    return ReauthorizationMarker();
                }

                var result = new JsonObject();
                foreach (var pair in obj)
                {
                    if (IsSensitiveName(pair.Key))
                    {
                        result[pair.Key] = ReauthorizationMarker();
                        continue;
                    }

                    result[pair.Key] = pair.Value switch
                    {
                        JsonValue value when value.TryGetValue<string>(out var text) =>
                            JsonValue.Create(ScrubText(text)),
                        _ => ScrubNode(pair.Value, $"{context}.{pair.Key}"),
                    };
                }
                return result;
            case JsonArray array:
                var items = new JsonArray();
                foreach (var item in array)
                {
                    items.Add(item switch
                    {
                        JsonValue value when value.TryGetValue<string>(out var text) =>
                            JsonValue.Create(ScrubText(text)),
                        _ => ScrubNode(item, context),
                    });
                }
                return items;
            case JsonValue scalar when scalar.TryGetValue<string>(out var text):
                return JsonValue.Create(ScrubText(text));
            default:
                return node.DeepClone();
        }
    }

    private static JsonObject ReauthorizationMarker() => new()
    {
        ["$tamma"] = "reauthorize",
        ["kind"] = "credential",
    };

    private static bool IsSecretEnvelope(JsonObject obj)
    {
        var names = obj.Select(p => NormalizeName(p.Key)).ToHashSet(StringComparer.Ordinal);
        return names.Contains("ciphertext")
            || names.Contains("encryptedvalue")
            || names.Contains("encryptedsecret")
            || (names.Contains("envelope") && names.Contains("nonce"));
    }

    private static bool IsSensitiveName(string name)
    {
        var normalized = NormalizeName(name);
        if (normalized is "maxtokens" or "tokensin" or "tokensout" or "platformtokensin"
            or "platformtokensout" or "byoktokensin" or "byoktokensout" or "totaltokens")
        {
            return false;
        }

        return normalized.Contains("password", StringComparison.Ordinal)
            || normalized.Contains("passphrase", StringComparison.Ordinal)
            || normalized.Contains("secret", StringComparison.Ordinal)
            || normalized.Contains("credential", StringComparison.Ordinal)
            || normalized.Contains("apikey", StringComparison.Ordinal)
            || normalized.Contains("authorization", StringComparison.Ordinal)
            || normalized.Contains("privatekey", StringComparison.Ordinal)
            || normalized.Contains("encryptionkey", StringComparison.Ordinal)
            || normalized.Contains("signingkey", StringComparison.Ordinal)
            || normalized.Contains("connectionstring", StringComparison.Ordinal)
            || normalized.EndsWith("token", StringComparison.Ordinal)
            || normalized is "token" or "accesstoken" or "refreshtoken" or "idtoken"
                or "authtoken" or "bearertoken" or "clienttoken" or "sessiontoken"
                or "emailverificationtokenhash" or "passwordresettokenhash";
    }

    private static string NormalizeName(string name) =>
        new(name.Where(char.IsLetterOrDigit).Select(char.ToLowerInvariant).ToArray());

    private static bool LooksLikeConnectionString(string value)
    {
        var hasPassword = value.Contains("password=", StringComparison.OrdinalIgnoreCase)
            || value.Contains("pwd=", StringComparison.OrdinalIgnoreCase);
        var hasHost = value.Contains("host=", StringComparison.OrdinalIgnoreCase)
            || value.Contains("server=", StringComparison.OrdinalIgnoreCase)
            || value.Contains("data source=", StringComparison.OrdinalIgnoreCase);
        return hasPassword && hasHost;
    }

    [GeneratedRegex("(?i)\\b(password|passwd|pwd|token|api[_-]?key|secret|authorization|private[_-]?key|connection[_-]?string)\\b\\s*[:=]\\s*(?:\\\"[^\\\"]*\\\"|'[^']*'|[^\\s,;]+)")]
    private static partial Regex SecretAssignmentRegex();

    [GeneratedRegex(@"(?i)\b(bearer\s+)[A-Za-z0-9._~+/=-]+")]
    private static partial Regex BearerRegex();

    [GeneratedRegex(@"://[^/\s:@]+:[^/\s@]+@")]
    private static partial Regex UserInfoRegex();

    [GeneratedRegex(@"\b(?:gh[pousr]_[A-Za-z0-9]{16,}|sk-[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b")]
    private static partial Regex CommonTokenRegex();
}
