using System.Text.Json.Nodes;

namespace Tamma.Api.Services.LocalExport;

internal static class LocalExportFormat
{
    public const string Name = "tamma-local-export-v1";
    public const int Version = 1;
    public const string ArchiveFileName = $"{Name}.tar.gz";
    public const string MetadataMember = "metadata.json";
    public const string StateMember = "state.sqlite";
    public const string ManifestMember = "manifest.json";
    public const string SignatureMember = "manifest.sig";
    public const string SignatureAlgorithm = "Ed25519";
}

internal sealed class LocalExportException : Exception
{
    public LocalExportException(string code, string safeMessage) : base(safeMessage)
    {
        Code = code;
    }

    public string Code { get; }
}

internal sealed record LocalExportRow(string Id, int Ordinal, JsonObject Payload);

internal sealed record LocalExportDataset(string Name, IReadOnlyList<LocalExportRow> Rows);

internal sealed record LocalExportCapture(
    string SourceRevision,
    IReadOnlyList<string> ControlPlaneMigrations,
    IReadOnlyList<string> TenantMigrations,
    string Watermark,
    JsonObject User,
    JsonObject Tenant,
    IReadOnlyList<LocalExportDataset> Datasets);

internal interface ILocalExportSource
{
    Task<LocalExportCapture> CaptureAsync(CancellationToken cancellationToken);
}

internal sealed class LocalExportManifest
{
    public string Format { get; set; } = LocalExportFormat.Name;
    public int FormatVersion { get; set; } = LocalExportFormat.Version;
    public LocalExportSourceDescriptor Source { get; set; } = new();
    public LocalExportCaptureDescriptor Capture { get; set; } = new();
    public List<LocalExportDatasetDescriptor> Datasets { get; set; } = [];
    public List<LocalExportPayloadDescriptor> Payloads { get; set; } = [];
    public LocalExportSignatureDescriptor Signature { get; set; } = new();
}

internal sealed class LocalExportSourceDescriptor
{
    public string Revision { get; set; } = string.Empty;
    public List<string> ControlPlaneMigrations { get; set; } = [];
    public List<string> TenantMigrations { get; set; } = [];
    public string Watermark { get; set; } = string.Empty;
}

internal sealed class LocalExportCaptureDescriptor
{
    public string CapturedAtUtc { get; set; } = string.Empty;
    public string DeploymentMode { get; set; } = "single-user";
    public string UserId { get; set; } = string.Empty;
    public string TenantId { get; set; } = string.Empty;
}

internal sealed class LocalExportDatasetDescriptor
{
    public string Name { get; set; } = string.Empty;
    public long RowCount { get; set; }
}

internal sealed class LocalExportPayloadDescriptor
{
    public string Name { get; set; } = string.Empty;
    public long Size { get; set; }
    public string Sha256 { get; set; } = string.Empty;
}

internal sealed class LocalExportSignatureDescriptor
{
    public string Algorithm { get; set; } = LocalExportFormat.SignatureAlgorithm;
    public string KeyId { get; set; } = string.Empty;
}

internal sealed record LocalExportVerificationResult(
    Guid UserId,
    Guid TenantId,
    long RowCount,
    IReadOnlyDictionary<string, long> DatasetCounts);
