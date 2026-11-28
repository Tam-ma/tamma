using System.Text;
using System.Text.Json.Nodes;
using FluentAssertions;
using Microsoft.Data.Sqlite;
using NUnit.Framework;
using Tamma.Api.Services.LocalExport;

namespace Tamma.Api.Tests.Services.LocalExport;

[TestFixture]
public sealed class LocalExportArchiveTests
{
    private string _directory = null!;

    [SetUp]
    public void SetUp()
    {
        _directory = Path.Combine(Path.GetTempPath(), $"tamma-export-tests-{Guid.NewGuid():N}");
        Directory.CreateDirectory(_directory);
    }

    [TearDown]
    public void TearDown()
    {
        if (Directory.Exists(_directory)) Directory.Delete(_directory, recursive: true);
    }

    [Test]
    public async Task Export_round_trips_both_planes_and_reauthorizes_secrets()
    {
        var output = Path.Combine(_directory, LocalExportFormat.ArchiveFileName);
        var result = await ExportAsync(output);

        result.UserId.Should().Be(LocalExportTestFixture.UserId);
        result.TenantId.Should().Be(LocalExportTestFixture.TenantId);
        result.RowCount.Should().Be(9);
        result.DatasetCounts["tenant.domain_events"].Should().Be(1);
        result.DatasetCounts["control_plane.provider_settings"].Should().Be(1);
        var members = await LocalExportTestFixture.ReadArchiveAsync(output);
        members.Keys.Should().BeEquivalentTo(
            LocalExportFormat.MetadataMember,
            LocalExportFormat.StateMember,
            LocalExportFormat.ManifestMember,
            LocalExportFormat.SignatureMember);
        var text = LocalExportTestFixture.AllArchiveText(members);
        text.Should().NotContain(LocalExportTestFixture.TokenCanary)
            .And.NotContain(LocalExportTestFixture.PasswordCanary)
            .And.NotContain(LocalExportTestFixture.ConnectionCanary)
            .And.NotContain(LocalExportTestFixture.EnvelopeCanary);
        text.Should().Contain("reauthorize").And.Contain("preserved");

        var imported = new HashSet<string>(StringComparer.Ordinal);
        ImportIdempotently(members[LocalExportFormat.StateMember], imported);
        ImportIdempotently(members[LocalExportFormat.StateMember], imported);
        imported.Should().HaveCount(9);
    }

    [Test]
    public async Task Repeating_a_quiesced_capture_is_byte_deterministic()
    {
        var first = Path.Combine(_directory, "first.tar.gz");
        var second = Path.Combine(_directory, "second.tar.gz");
        await ExportAsync(first);
        await ExportAsync(second);

        (await File.ReadAllBytesAsync(first)).Should().Equal(await File.ReadAllBytesAsync(second));
    }

    [Test]
    public async Task Verifier_rejects_payload_tampering()
    {
        var output = await ValidArchiveAsync();
        var members = await LocalExportTestFixture.ReadArchiveAsync(output);
        var state = members[LocalExportFormat.StateMember];
        state[state.Length - 100] ^= 0x7f;
        members[LocalExportFormat.StateMember] = state;
        var tampered = Path.Combine(_directory, "tampered.tar.gz");
        await LocalExportTestFixture.WriteArchiveAsync(tampered, members);

        var act = () => LocalExportArchive.VerifyAsync(tampered, LocalExportTestFixture.Signer().PublicKey);
        await act.Should().ThrowAsync<LocalExportException>()
            .Where(ex => ex.Code == "VERIFY.DIGEST.INVALID");
    }

    [Test]
    public async Task Verifier_rejects_untrusted_signer_even_when_archive_is_valid()
    {
        var output = await ValidArchiveAsync();
        var act = () => LocalExportArchive.VerifyAsync(output, LocalExportTestFixture.Signer(9).PublicKey);
        await act.Should().ThrowAsync<LocalExportException>()
            .Where(ex => ex.Code == "VERIFY.SIGNER.UNTRUSTED");
    }

    [Test]
    public async Task Verifier_rejects_resigned_unsupported_version()
    {
        var output = await ValidArchiveAsync();
        var members = await LocalExportTestFixture.ReadArchiveAsync(output);
        await LocalExportTestFixture.ResignAsync(members, LocalExportTestFixture.Signer(),
            manifest => manifest["formatVersion"] = 2);
        var unsupported = Path.Combine(_directory, "unsupported.tar.gz");
        await LocalExportTestFixture.WriteArchiveAsync(unsupported, members);

        var act = () => LocalExportArchive.VerifyAsync(unsupported, LocalExportTestFixture.Signer().PublicKey);
        await act.Should().ThrowAsync<LocalExportException>()
            .Where(ex => ex.Code == "VERIFY.VERSION.UNSUPPORTED");
    }

    [Test]
    public async Task Verifier_rejects_unexpected_members_before_import()
    {
        var output = await ValidArchiveAsync();
        var members = await LocalExportTestFixture.ReadArchiveAsync(output);
        members["unexpected.txt"] = Encoding.UTF8.GetBytes("unexpected");
        var unexpected = Path.Combine(_directory, "unexpected.tar.gz");
        await LocalExportTestFixture.WriteArchiveAsync(unexpected, members);

        var act = () => LocalExportArchive.VerifyAsync(unexpected, LocalExportTestFixture.Signer().PublicKey);
        await act.Should().ThrowAsync<LocalExportException>()
            .Where(ex => ex.Code == "VERIFY.MEMBERS.INVALID");
    }

    [Test]
    public async Task Verifier_rejects_incomplete_sqlite_after_valid_resigning()
    {
        var output = await ValidArchiveAsync();
        var members = await LocalExportTestFixture.ReadArchiveAsync(output);
        var statePath = Path.Combine(_directory, "incomplete.sqlite");
        await File.WriteAllBytesAsync(statePath, members[LocalExportFormat.StateMember]);
        await using (var connection = new SqliteConnection($"Data Source={statePath}"))
        {
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = "DELETE FROM export_rows WHERE dataset = 'tenant.conventions';";
            await command.ExecuteNonQueryAsync();
        }
        members[LocalExportFormat.StateMember] = await File.ReadAllBytesAsync(statePath);
        await LocalExportTestFixture.UpdatePayloadDigestAsync(members, LocalExportFormat.StateMember);
        var incomplete = Path.Combine(_directory, "incomplete.tar.gz");
        await LocalExportTestFixture.WriteArchiveAsync(incomplete, members);

        var act = () => LocalExportArchive.VerifyAsync(incomplete, LocalExportTestFixture.Signer().PublicKey);
        await act.Should().ThrowAsync<LocalExportException>()
            .Where(ex => ex.Code == "VERIFY.COMPLETENESS.INVALID");
    }

    [Test]
    public async Task Interrupted_read_publishes_nothing_and_leaves_no_canary_artifacts()
    {
        var output = Path.Combine(_directory, LocalExportFormat.ArchiveFileName);
        var source = new StubLocalExportSource(_ =>
            throw new OperationCanceledException(LocalExportTestFixture.TokenCanary));
        var act = () => new LocalExportService(new FixedTimeProvider()).ExportAsync(
            source, output, LocalExportTestFixture.Signer(), false, CancellationToken.None);
        await act.Should().ThrowAsync<LocalExportException>()
            .Where(ex => ex.Code == "EXPORT.CANCELLED");

        AssertNoOutputOrCanaries(output);
    }

    [Test]
    public async Task Failed_capture_preserves_existing_archive_and_cleans_staging()
    {
        var output = await ValidArchiveAsync();
        var original = await File.ReadAllBytesAsync(output);
        var source = new StubLocalExportSource(_ =>
            throw new LocalExportException("EXPORT.READ.FAILED", "Source read failed safely."));
        var act = () => new LocalExportService(new FixedTimeProvider()).ExportAsync(
            source, output, LocalExportTestFixture.Signer(), true, CancellationToken.None);
        await act.Should().ThrowAsync<LocalExportException>();

        (await File.ReadAllBytesAsync(output)).Should().Equal(original);
        Directory.EnumerateFileSystemEntries(_directory, "*.staging", SearchOption.TopDirectoryOnly).Should().BeEmpty();
    }

    [Test]
    public async Task Write_failure_publishes_no_partial_archive()
    {
        var destinationDirectory = Path.Combine(_directory, "destination-is-a-directory");
        Directory.CreateDirectory(destinationDirectory);
        var source = new StubLocalExportSource(_ => Task.FromResult(LocalExportTestFixture.Capture()));
        var act = () => new LocalExportService(new FixedTimeProvider()).ExportAsync(
            source, destinationDirectory, LocalExportTestFixture.Signer(), false, CancellationToken.None);
        await act.Should().ThrowAsync<LocalExportException>()
            .Where(ex => ex.Code == "EXPORT.WRITE.FAILED");

        Directory.EnumerateFileSystemEntries(destinationDirectory).Should().BeEmpty();
        Directory.EnumerateFileSystemEntries(_directory, "*.staging", SearchOption.TopDirectoryOnly).Should().BeEmpty();
    }

    private async Task<LocalExportVerificationResult> ExportAsync(string output)
    {
        var source = new StubLocalExportSource(_ => Task.FromResult(LocalExportTestFixture.Capture()));
        return await new LocalExportService(new FixedTimeProvider()).ExportAsync(
            source, output, LocalExportTestFixture.Signer(), false, CancellationToken.None);
    }

    private Task<string> ValidArchiveAsync() => ValidArchiveCoreAsync();

    private async Task<string> ValidArchiveCoreAsync()
    {
        var output = Path.Combine(_directory, $"{Guid.NewGuid():N}.tar.gz");
        await ExportAsync(output);
        return output;
    }

    private void AssertNoOutputOrCanaries(string output)
    {
        File.Exists(output).Should().BeFalse();
        Directory.EnumerateFileSystemEntries(_directory, "*.staging", SearchOption.TopDirectoryOnly).Should().BeEmpty();
        foreach (var file in Directory.EnumerateFiles(_directory, "*", SearchOption.AllDirectories))
        {
            File.ReadAllText(file).Should().NotContain(LocalExportTestFixture.TokenCanary);
        }
    }

    private static void ImportIdempotently(byte[] state, ISet<string> imported)
    {
        var path = Path.Combine(Path.GetTempPath(), $"tamma-import-test-{Guid.NewGuid():N}.sqlite");
        try
        {
            File.WriteAllBytes(path, state);
            using var connection = new SqliteConnection($"Data Source={path};Mode=ReadOnly");
            connection.Open();
            using var command = connection.CreateCommand();
            command.CommandText = "SELECT dataset, id FROM export_rows ORDER BY dataset, ordinal;";
            using var reader = command.ExecuteReader();
            while (reader.Read()) imported.Add($"{reader.GetString(0)}/{reader.GetString(1)}");
        }
        finally
        {
            File.Delete(path);
        }
    }
}
