using System.Formats.Tar;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;

namespace Tamma.Api.Services.LocalExport;

internal static partial class LocalExportArchive
{
    private const long MaxArchiveBytes = 512L * 1024 * 1024;
    private const long MaxMemberBytes = 512L * 1024 * 1024;
    private const long MaxExpandedBytes = 1024L * 1024 * 1024;
    private static readonly string[] ExpectedMembers =
    [
        LocalExportFormat.MetadataMember,
        LocalExportFormat.StateMember,
        LocalExportFormat.ManifestMember,
        LocalExportFormat.SignatureMember,
    ];

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = false,
        WriteIndented = false,
    };

    public static async Task<string> WriteAsync(
        string stagingDirectory,
        LocalExportCapture capture,
        DateTimeOffset capturedAt,
        LocalExportSigner signer,
        CancellationToken cancellationToken)
    {
        var datasets = capture.Datasets.OrderBy(d => d.Name, StringComparer.Ordinal).ToArray();
        ValidateCapture(capture, datasets);

        var metadata = new JsonObject
        {
            ["format"] = LocalExportFormat.Name,
            ["formatVersion"] = LocalExportFormat.Version,
            ["user"] = capture.User.DeepClone(),
            ["tenant"] = capture.Tenant.DeepClone(),
            ["controlPlaneMigrations"] = ToJsonArray(capture.ControlPlaneMigrations),
            ["tenantMigrations"] = ToJsonArray(capture.TenantMigrations),
            ["datasets"] = new JsonArray(datasets.Select(d => new JsonObject
            {
                ["name"] = d.Name,
                ["rowCount"] = d.Rows.Count,
            }).ToArray<JsonNode?>()),
        };
        var metadataBytes = Encoding.UTF8.GetBytes(metadata.ToJsonString());
        var metadataPath = Path.Combine(stagingDirectory, LocalExportFormat.MetadataMember);
        await WritePrivateFileAsync(metadataPath, metadataBytes, cancellationToken).ConfigureAwait(false);

        var statePath = Path.Combine(stagingDirectory, LocalExportFormat.StateMember);
        await WriteSqliteAsync(statePath, capture, datasets, cancellationToken).ConfigureAwait(false);
        var stateBytes = await File.ReadAllBytesAsync(statePath, cancellationToken).ConfigureAwait(false);

        var manifest = new LocalExportManifest
        {
            Source = new LocalExportSourceDescriptor
            {
                Revision = capture.SourceRevision,
                ControlPlaneMigrations = capture.ControlPlaneMigrations.Order(StringComparer.Ordinal).ToList(),
                TenantMigrations = capture.TenantMigrations.Order(StringComparer.Ordinal).ToList(),
                Watermark = capture.Watermark,
            },
            Capture = new LocalExportCaptureDescriptor
            {
                CapturedAtUtc = capturedAt.UtcDateTime.ToString("O"),
                UserId = RequiredString(capture.User["id"]),
                TenantId = RequiredString(capture.Tenant["id"]),
            },
            Datasets = datasets.Select(d => new LocalExportDatasetDescriptor
            {
                Name = d.Name,
                RowCount = d.Rows.Count,
            }).ToList(),
            Payloads =
            [
                Descriptor(LocalExportFormat.MetadataMember, metadataBytes),
                Descriptor(LocalExportFormat.StateMember, stateBytes),
            ],
            Signature = new LocalExportSignatureDescriptor { KeyId = signer.KeyId },
        };
        var manifestBytes = JsonSerializer.SerializeToUtf8Bytes(manifest, JsonOptions);
        var manifestPath = Path.Combine(stagingDirectory, LocalExportFormat.ManifestMember);
        await WritePrivateFileAsync(manifestPath, manifestBytes, cancellationToken).ConfigureAwait(false);
        var signaturePath = Path.Combine(stagingDirectory, LocalExportFormat.SignatureMember);
        await WritePrivateFileAsync(signaturePath, signer.Sign(manifestBytes), cancellationToken).ConfigureAwait(false);

        var archivePath = Path.Combine(stagingDirectory, LocalExportFormat.ArchiveFileName + ".tmp");
        await using (var output = new FileStream(
            archivePath, FileMode.CreateNew, FileAccess.Write, FileShare.None,
            81920, FileOptions.Asynchronous | FileOptions.SequentialScan))
        {
            SetPrivateFileMode(archivePath);
            await using var gzip = new GZipStream(output, CompressionLevel.Optimal, leaveOpen: true);
            await using var tar = new TarWriter(gzip, TarEntryFormat.Ustar, leaveOpen: true);
            foreach (var name in ExpectedMembers)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var path = Path.Combine(stagingDirectory, name);
                await using var input = new FileStream(
                    path, FileMode.Open, FileAccess.Read, FileShare.Read,
                    81920, FileOptions.Asynchronous | FileOptions.SequentialScan);
                var entry = new UstarTarEntry(TarEntryType.RegularFile, name)
                {
                    DataStream = input,
                    ModificationTime = DateTimeOffset.UnixEpoch,
                    Mode = UnixFileMode.UserRead | UnixFileMode.UserWrite,
                    Uid = 0,
                    Gid = 0,
                };
                await tar.WriteEntryAsync(entry, cancellationToken).ConfigureAwait(false);
            }
        }

        await VerifyAsync(archivePath, signer.PublicKey, cancellationToken).ConfigureAwait(false);
        return archivePath;
    }

    public static async Task<LocalExportVerificationResult> VerifyAsync(
        string archivePath,
        byte[] trustedPublicKey,
        CancellationToken cancellationToken = default)
    {
        var fileInfo = new FileInfo(archivePath);
        if (!fileInfo.Exists || fileInfo.Length == 0 || fileInfo.Length > MaxArchiveBytes)
        {
            throw new LocalExportException("VERIFY.ARCHIVE.INVALID", "Export archive is missing, empty, or too large.");
        }

        var members = await ReadMembersAsync(archivePath, cancellationToken).ConfigureAwait(false);
        if (members.Count != ExpectedMembers.Length || ExpectedMembers.Any(name => !members.ContainsKey(name)))
        {
            throw new LocalExportException("VERIFY.MEMBERS.INVALID", "Export archive member set is incomplete or unsupported.");
        }

        LocalExportManifest manifest;
        try
        {
            manifest = JsonSerializer.Deserialize<LocalExportManifest>(
                members[LocalExportFormat.ManifestMember], JsonOptions)
                ?? throw new JsonException();
        }
        catch (JsonException)
        {
            throw new LocalExportException("VERIFY.MANIFEST.INVALID", "Export manifest is malformed.");
        }

        ValidateManifest(manifest, members);
        if (!string.Equals(manifest.Signature.Algorithm, LocalExportFormat.SignatureAlgorithm, StringComparison.Ordinal)
            || !string.Equals(manifest.Signature.KeyId, LocalExportSigner.ComputeKeyId(trustedPublicKey), StringComparison.Ordinal))
        {
            throw new LocalExportException("VERIFY.SIGNER.UNTRUSTED", "Export signer is not trusted.");
        }

        if (!LocalExportSigner.Verify(
                trustedPublicKey,
                members[LocalExportFormat.ManifestMember],
                members[LocalExportFormat.SignatureMember]))
        {
            throw new LocalExportException("VERIFY.SIGNATURE.INVALID", "Export manifest signature is invalid.");
        }

        foreach (var payload in manifest.Payloads)
        {
            var bytes = members[payload.Name];
            if (bytes.LongLength != payload.Size
                || !string.Equals(Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
                    payload.Sha256, StringComparison.Ordinal))
            {
                throw new LocalExportException("VERIFY.DIGEST.INVALID", "Export payload size or digest does not match the manifest.");
            }
        }

        return VerifySqlite(manifest, members[LocalExportFormat.StateMember]);
    }

    private static async Task<Dictionary<string, byte[]>> ReadMembersAsync(
        string archivePath,
        CancellationToken cancellationToken)
    {
        var members = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        long expandedBytes = 0;
        try
        {
            await using var input = new FileStream(
                archivePath, FileMode.Open, FileAccess.Read, FileShare.Read,
                81920, FileOptions.Asynchronous | FileOptions.SequentialScan);
            await using var gzip = new GZipStream(input, CompressionMode.Decompress);
            await using var tar = new TarReader(gzip, leaveOpen: false);
            while (await tar.GetNextEntryAsync().ConfigureAwait(false) is TarEntry entry)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (entry.EntryType != TarEntryType.RegularFile
                    || entry.DataStream is null
                    || string.IsNullOrEmpty(entry.Name)
                    || entry.Name != Path.GetFileName(entry.Name)
                    || !members.TryAdd(entry.Name, [])
                    || entry.Length < 0
                    || entry.Length > MaxMemberBytes
                    || expandedBytes + entry.Length > MaxExpandedBytes)
                {
                    throw new LocalExportException("VERIFY.MEMBERS.INVALID", "Export archive contains an unsafe or duplicate member.");
                }

                var bytes = await ReadBoundedAsync(entry.DataStream, entry.Length, cancellationToken).ConfigureAwait(false);
                expandedBytes += bytes.LongLength;
                members[entry.Name] = bytes;
            }
        }
        catch (Exception ex) when (ex is InvalidDataException or IOException or ArgumentException)
        {
            throw new LocalExportException("VERIFY.ARCHIVE.INVALID", "Export archive cannot be read safely.");
        }

        return members;
    }

    private static async Task<byte[]> ReadBoundedAsync(
        Stream input,
        long declaredLength,
        CancellationToken cancellationToken)
    {
        var output = new MemoryStream(declaredLength <= int.MaxValue ? (int)declaredLength : 0);
        var buffer = new byte[81920];
        while (true)
        {
            var read = await input.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
            if (read == 0) break;
            if (output.Length + read > MaxMemberBytes || output.Length + read > declaredLength)
            {
                throw new LocalExportException("VERIFY.MEMBERS.INVALID", "Export archive member exceeds its declared bounds.");
            }
            output.Write(buffer, 0, read);
        }

        if (output.Length != declaredLength)
        {
            throw new LocalExportException("VERIFY.MEMBERS.INVALID", "Export archive member is truncated.");
        }
        return output.ToArray();
    }

    private static void ValidateManifest(
        LocalExportManifest manifest,
        IReadOnlyDictionary<string, byte[]> members)
    {
        if (!string.Equals(manifest.Format, LocalExportFormat.Name, StringComparison.Ordinal)
            || manifest.FormatVersion != LocalExportFormat.Version)
        {
            throw new LocalExportException("VERIFY.VERSION.UNSUPPORTED", "Export format or version is unsupported.");
        }

        if (string.IsNullOrWhiteSpace(manifest.Source.Revision)
            || string.IsNullOrWhiteSpace(manifest.Source.Watermark)
            || manifest.Source.ControlPlaneMigrations.Count == 0
            || manifest.Source.TenantMigrations.Count == 0
            || !Guid.TryParse(manifest.Capture.UserId, out _)
            || !Guid.TryParse(manifest.Capture.TenantId, out _)
            || !DateTimeOffset.TryParse(manifest.Capture.CapturedAtUtc, out _)
            || !string.Equals(manifest.Capture.DeploymentMode, "single-user", StringComparison.Ordinal))
        {
            throw new LocalExportException("VERIFY.MANIFEST.INVALID", "Export manifest capture metadata is incomplete.");
        }

        if (manifest.Payloads.Count != 2
            || manifest.Payloads.Select(p => p.Name).Distinct(StringComparer.Ordinal).Count() != 2
            || manifest.Payloads.Any(p => p.Name is not (LocalExportFormat.MetadataMember or LocalExportFormat.StateMember)
                || p.Size < 0
                || p.Size != members[p.Name].LongLength
                || !Sha256Regex().IsMatch(p.Sha256)))
        {
            throw new LocalExportException("VERIFY.PAYLOADS.INVALID", "Export payload descriptors are incomplete.");
        }

        if (manifest.Datasets.Count == 0
            || manifest.Datasets.Select(d => d.Name).Distinct(StringComparer.Ordinal).Count() != manifest.Datasets.Count
            || manifest.Datasets.Any(d => string.IsNullOrWhiteSpace(d.Name) || d.RowCount < 0))
        {
            throw new LocalExportException("VERIFY.DATASETS.INVALID", "Export dataset descriptors are incomplete.");
        }
    }

    private static LocalExportVerificationResult VerifySqlite(LocalExportManifest manifest, byte[] stateBytes)
    {
        var tempPath = Path.Combine(Path.GetTempPath(), $".tamma-export-verify-{Guid.NewGuid():N}.sqlite");
        try
        {
            File.WriteAllBytes(tempPath, stateBytes);
            SetPrivateFileMode(tempPath);
            using var connection = new SqliteConnection(new SqliteConnectionStringBuilder
            {
                DataSource = tempPath,
                Mode = SqliteOpenMode.ReadOnly,
            }.ToString());
            connection.Open();
            using (var pragma = connection.CreateCommand())
            {
                pragma.CommandText = "PRAGMA integrity_check;";
                if (!string.Equals(pragma.ExecuteScalar() as string, "ok", StringComparison.OrdinalIgnoreCase))
                {
                    throw new LocalExportException("VERIFY.SQLITE.INVALID", "Export SQLite integrity check failed.");
                }
            }

            var expectedTables = new[] { "datasets", "export_metadata", "export_rows" };
            var tables = QueryStrings(connection,
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%';");
            if (!tables.Order(StringComparer.Ordinal).SequenceEqual(expectedTables.Order(StringComparer.Ordinal)))
            {
                throw new LocalExportException("VERIFY.SQLITE.INVALID", "Export SQLite schema is unsupported.");
            }

            var metadata = new Dictionary<string, string>(StringComparer.Ordinal);
            using (var command = connection.CreateCommand())
            {
                command.CommandText = "SELECT key, value FROM export_metadata;";
                using var reader = command.ExecuteReader();
                while (reader.Read())
                {
                    if (!metadata.TryAdd(reader.GetString(0), reader.GetString(1)))
                    {
                        throw new LocalExportException("VERIFY.SQLITE.INVALID", "Export SQLite metadata is ambiguous.");
                    }
                }
            }

            if (metadata.GetValueOrDefault("format") != LocalExportFormat.Name
                || metadata.GetValueOrDefault("format_version") != LocalExportFormat.Version.ToString())
            {
                throw new LocalExportException("VERIFY.VERSION.UNSUPPORTED", "Export SQLite format version is unsupported.");
            }

            var actual = new Dictionary<string, long>(StringComparer.Ordinal);
            using (var command = connection.CreateCommand())
            {
                command.CommandText = "SELECT dataset, COUNT(*) FROM export_rows GROUP BY dataset;";
                using var reader = command.ExecuteReader();
                while (reader.Read()) actual.Add(reader.GetString(0), reader.GetInt64(1));
            }

            var declared = new Dictionary<string, long>(StringComparer.Ordinal);
            using (var command = connection.CreateCommand())
            {
                command.CommandText = "SELECT name, row_count FROM datasets;";
                using var reader = command.ExecuteReader();
                while (reader.Read()) declared.Add(reader.GetString(0), reader.GetInt64(1));
            }

            var expected = manifest.Datasets.ToDictionary(d => d.Name, d => d.RowCount, StringComparer.Ordinal);
            if (!CountsEqual(expected, declared))
            {
                throw new LocalExportException("VERIFY.COMPLETENESS.INVALID", "Export SQLite dataset table does not match the manifest.");
            }

            foreach (var dataset in expected)
            {
                if (actual.GetValueOrDefault(dataset.Key) != dataset.Value)
                {
                    throw new LocalExportException("VERIFY.COMPLETENESS.INVALID", "Export SQLite row counts do not match the manifest.");
                }
            }

            if (actual.Keys.Any(name => !expected.ContainsKey(name)))
            {
                throw new LocalExportException("VERIFY.COMPLETENESS.INVALID", "Export SQLite contains unexpected datasets.");
            }

            using (var command = connection.CreateCommand())
            {
                command.CommandText = "SELECT id, payload_json FROM export_rows;";
                using var reader = command.ExecuteReader();
                while (reader.Read())
                {
                    try
                    {
                        var payload = JsonNode.Parse(reader.GetString(1)) as JsonObject;
                        if (payload is null || RequiredString(payload["id"]) != reader.GetString(0))
                        {
                            throw new LocalExportException("VERIFY.SQLITE.INVALID", "Export SQLite row identity is invalid.");
                        }
                    }
                    catch (JsonException)
                    {
                        throw new LocalExportException("VERIFY.SQLITE.INVALID", "Export SQLite contains malformed row JSON.");
                    }
                }
            }

            return new LocalExportVerificationResult(
                Guid.Parse(manifest.Capture.UserId),
                Guid.Parse(manifest.Capture.TenantId),
                expected.Values.Sum(),
                expected);
        }
        catch (SqliteException)
        {
            throw new LocalExportException("VERIFY.SQLITE.INVALID", "Export SQLite database is invalid.");
        }
        finally
        {
            try { File.Delete(tempPath); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        }
    }

    private static async Task WriteSqliteAsync(
        string path,
        LocalExportCapture capture,
        IReadOnlyList<LocalExportDataset> datasets,
        CancellationToken cancellationToken)
    {
        await using var connection = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = path,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Pooling = false,
        }.ToString());
        await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        SetPrivateFileMode(path);
        using (var pragma = connection.CreateCommand())
        {
            pragma.CommandText = "PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;";
            pragma.ExecuteNonQuery();
        }
        using (var schema = connection.CreateCommand())
        {
            schema.CommandText = """
                CREATE TABLE export_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE datasets (name TEXT PRIMARY KEY, row_count INTEGER NOT NULL CHECK(row_count >= 0));
                CREATE TABLE export_rows (
                    dataset TEXT NOT NULL REFERENCES datasets(name),
                    ordinal INTEGER NOT NULL,
                    id TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    PRIMARY KEY(dataset, ordinal),
                    UNIQUE(dataset, id)
                );
                """;
            schema.ExecuteNonQuery();
        }

        using var transaction = connection.BeginTransaction();
        InsertMetadata(connection, transaction, "format", LocalExportFormat.Name);
        InsertMetadata(connection, transaction, "format_version", LocalExportFormat.Version.ToString());
        InsertMetadata(connection, transaction, "source_revision", capture.SourceRevision);
        InsertMetadata(connection, transaction, "watermark", capture.Watermark);
        InsertMetadata(connection, transaction, "user_id", RequiredString(capture.User["id"]));
        InsertMetadata(connection, transaction, "tenant_id", RequiredString(capture.Tenant["id"]));
        foreach (var dataset in datasets)
        {
            using var datasetCommand = connection.CreateCommand();
            datasetCommand.Transaction = transaction;
            datasetCommand.CommandText = "INSERT INTO datasets(name, row_count) VALUES($name, $count);";
            datasetCommand.Parameters.AddWithValue("$name", dataset.Name);
            datasetCommand.Parameters.AddWithValue("$count", dataset.Rows.Count);
            datasetCommand.ExecuteNonQuery();

            foreach (var row in dataset.Rows.OrderBy(r => r.Ordinal))
            {
                cancellationToken.ThrowIfCancellationRequested();
                using var rowCommand = connection.CreateCommand();
                rowCommand.Transaction = transaction;
                rowCommand.CommandText = "INSERT INTO export_rows(dataset, ordinal, id, payload_json) VALUES($dataset, $ordinal, $id, $json);";
                rowCommand.Parameters.AddWithValue("$dataset", dataset.Name);
                rowCommand.Parameters.AddWithValue("$ordinal", row.Ordinal);
                rowCommand.Parameters.AddWithValue("$id", row.Id);
                rowCommand.Parameters.AddWithValue("$json", row.Payload.ToJsonString());
                rowCommand.ExecuteNonQuery();
            }
        }
        transaction.Commit();
        connection.Close();
    }

    private static void InsertMetadata(
        SqliteConnection connection,
        SqliteTransaction transaction,
        string key,
        string value)
    {
        using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "INSERT INTO export_metadata(key, value) VALUES($key, $value);";
        command.Parameters.AddWithValue("$key", key);
        command.Parameters.AddWithValue("$value", value);
        command.ExecuteNonQuery();
    }

    private static void ValidateCapture(LocalExportCapture capture, IReadOnlyList<LocalExportDataset> datasets)
    {
        if (string.IsNullOrWhiteSpace(capture.SourceRevision)
            || string.IsNullOrWhiteSpace(capture.Watermark)
            || capture.ControlPlaneMigrations.Count == 0
            || capture.TenantMigrations.Count == 0
            || !Guid.TryParse(RequiredString(capture.User["id"]), out _)
            || !Guid.TryParse(RequiredString(capture.Tenant["id"]), out _)
            || datasets.Count == 0
            || datasets.Select(d => d.Name).Distinct(StringComparer.Ordinal).Count() != datasets.Count)
        {
            throw new LocalExportException("EXPORT.CAPTURE.INVALID", "Export capture metadata is incomplete or ambiguous.");
        }

        foreach (var dataset in datasets)
        {
            if (!DatasetNameRegex().IsMatch(dataset.Name)
                || dataset.Rows.Select(r => r.Id).Distinct(StringComparer.Ordinal).Count() != dataset.Rows.Count)
            {
                throw new LocalExportException("EXPORT.DATASET.INVALID", "Export dataset names or row identities are invalid.");
            }

            var rows = dataset.Rows.OrderBy(r => r.Ordinal).ToArray();
            for (var i = 0; i < rows.Length; i++)
            {
                if (rows[i].Ordinal != i || RequiredString(rows[i].Payload["id"]) != rows[i].Id)
                {
                    throw new LocalExportException("EXPORT.DATASET.INVALID", "Export dataset ordering or row identity is invalid.");
                }
            }
        }
    }

    private static LocalExportPayloadDescriptor Descriptor(string name, byte[] bytes) => new()
    {
        Name = name,
        Size = bytes.LongLength,
        Sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
    };

    private static JsonArray ToJsonArray(IEnumerable<string> values) =>
        new(values.Order(StringComparer.Ordinal).Select(v => (JsonNode?)JsonValue.Create(v)).ToArray());

    private static string RequiredString(JsonNode? node)
    {
        if (node is JsonValue value && value.TryGetValue<string>(out var text) && !string.IsNullOrWhiteSpace(text))
        {
            return text;
        }
        throw new LocalExportException("EXPORT.CAPTURE.INVALID", "Export capture is missing a required identifier.");
    }

    private static bool CountsEqual(
        IReadOnlyDictionary<string, long> left,
        IReadOnlyDictionary<string, long> right) =>
        left.Count == right.Count && left.All(p => right.GetValueOrDefault(p.Key) == p.Value);

    private static List<string> QueryStrings(SqliteConnection connection, string sql)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        using var reader = command.ExecuteReader();
        var values = new List<string>();
        while (reader.Read()) values.Add(reader.GetString(0));
        return values;
    }

    private static async Task WritePrivateFileAsync(
        string path,
        byte[] bytes,
        CancellationToken cancellationToken)
    {
        await File.WriteAllBytesAsync(path, bytes, cancellationToken).ConfigureAwait(false);
        SetPrivateFileMode(path);
    }

    private static void SetPrivateFileMode(string path)
    {
        if (!OperatingSystem.IsWindows())
        {
            File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        }
    }

    [GeneratedRegex("^[a-f0-9]{64}$")]
    private static partial Regex Sha256Regex();

    [GeneratedRegex("^[a-z][a-z0-9_]*(?:\\.[a-z][a-z0-9_]*)*$")]
    private static partial Regex DatasetNameRegex();
}
