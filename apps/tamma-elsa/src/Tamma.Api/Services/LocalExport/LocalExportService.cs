namespace Tamma.Api.Services.LocalExport;

internal sealed class LocalExportService
{
    private readonly TimeProvider _timeProvider;

    public LocalExportService(TimeProvider? timeProvider = null)
    {
        _timeProvider = timeProvider ?? TimeProvider.System;
    }

    public async Task<LocalExportVerificationResult> ExportAsync(
        ILocalExportSource source,
        string outputPath,
        LocalExportSigner signer,
        bool overwrite,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(signer);
        var destination = Path.GetFullPath(outputPath);
        var destinationDirectory = Path.GetDirectoryName(destination)
            ?? throw new LocalExportException("EXPORT.OUTPUT.INVALID", "Export output directory is invalid.");
        if (!overwrite && File.Exists(destination))
        {
            throw new LocalExportException("EXPORT.OUTPUT.EXISTS", "Export destination already exists.");
        }

        Directory.CreateDirectory(destinationDirectory);
        var staging = Path.Combine(
            destinationDirectory,
            $".{Path.GetFileName(destination)}.{Guid.NewGuid():N}.staging");
        Directory.CreateDirectory(staging);
        SetPrivateDirectoryMode(staging);
        var published = false;
        try
        {
            var capture = await source.CaptureAsync(cancellationToken).ConfigureAwait(false);
            var archive = await LocalExportArchive.WriteAsync(
                staging, capture, _timeProvider.GetUtcNow(), signer, cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            File.Move(archive, destination, overwrite);
            published = true;
            File.SetAttributes(destination, FileAttributes.Normal);
            if (!OperatingSystem.IsWindows())
            {
                File.SetUnixFileMode(destination, UnixFileMode.UserRead | UnixFileMode.UserWrite);
            }
            return await LocalExportArchive.VerifyAsync(
                destination, signer.PublicKey, cancellationToken).ConfigureAwait(false);
        }
        catch (LocalExportException)
        {
            TryDeletePublishedPartial(destination, published);
            throw;
        }
        catch (OperationCanceledException)
        {
            TryDeletePublishedPartial(destination, published);
            throw new LocalExportException("EXPORT.CANCELLED", "Export was cancelled before completion.");
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or System.Security.Cryptography.CryptographicException)
        {
            TryDeletePublishedPartial(destination, published);
            throw new LocalExportException("EXPORT.WRITE.FAILED", "Export could not be staged, verified, or published.");
        }
        finally
        {
            TryDeleteStaging(staging);
        }
    }

    private static void TryDeletePublishedPartial(string destination, bool published)
    {
        if (published && File.Exists(destination))
        {
            try { File.Delete(destination); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        }
    }

    private static void TryDeleteStaging(string staging)
    {
        try { Directory.Delete(staging, recursive: true); } catch (DirectoryNotFoundException) { }
        catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    private static void SetPrivateDirectoryMode(string path)
    {
        if (!OperatingSystem.IsWindows())
        {
            File.SetUnixFileMode(path,
                UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        }
    }
}
