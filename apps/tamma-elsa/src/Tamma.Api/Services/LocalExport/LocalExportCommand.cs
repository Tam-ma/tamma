using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Tamma.Api.Infrastructure;
using Tamma.Api.Services.PromptStore;
using Tamma.Api.Services.Secrets;
using Tamma.Data;
using Tamma.Data.Abstractions;
using Tamma.Data.Pooling;

namespace Tamma.Api.Services.LocalExport;

internal static class LocalExportCommand
{
    public static bool ShouldRun(string[] args) =>
        args is { Length: > 0 }
        && (args[0].Equals("export-local", StringComparison.OrdinalIgnoreCase)
            || args[0].Equals("verify-local-export", StringComparison.OrdinalIgnoreCase));

    public static async Task<int> RunAsync(
        IConfiguration configuration,
        string[] args,
        CancellationToken cancellationToken = default)
    {
        using var shutdown = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        ConsoleCancelEventHandler cancel = (_, eventArgs) =>
        {
            eventArgs.Cancel = true;
            shutdown.Cancel();
        };
        Console.CancelKeyPress += cancel;
        try
        {
            if (args[0].Equals("verify-local-export", StringComparison.OrdinalIgnoreCase))
            {
                var archive = RequiredOption(args, "--archive");
                var trustedKey = RequiredOption(args, "--trusted-key-file");
                var verified = await LocalExportArchive.VerifyAsync(
                    Path.GetFullPath(archive),
                    LocalExportSigner.ReadTrustedPublicKeyFile(trustedKey),
                    shutdown.Token).ConfigureAwait(false);
                Console.WriteLine(
                    "verify-local-export: OK format={0} rows={1} user={2} tenant={3}",
                    LocalExportFormat.Name, verified.RowCount, verified.UserId, verified.TenantId);
                return 0;
            }

            if (TammaModeProvider.Resolve(configuration) == TammaMode.SaaS)
            {
                throw new LocalExportException("EXPORT.MODE.SAAS", "Local export is unavailable in SaaS deployment mode.");
            }

            var output = Option(args, "--output")
                ?? Path.Combine(Directory.GetCurrentDirectory(), LocalExportFormat.ArchiveFileName);
            var keyPath = Option(args, "--signing-key-file")
                ?? Environment.GetEnvironmentVariable("TAMMA_LOCAL_EXPORT_SIGNING_KEY_FILE")
                ?? throw new LocalExportException(
                    "EXPORT.KEY.REQUIRED", "Set --signing-key-file or TAMMA_LOCAL_EXPORT_SIGNING_KEY_FILE.");
            var signer = LocalExportSigner.FromFile(keyPath);
            var services = new ServiceCollection();
            services.AddSingleton(configuration);
            services.AddLogging(logging => logging.ClearProviders());
            services.AddSingleton<KekProvider>();
            services.AddSingleton<IConnectionStringDecryptor, AesGcmConnectionStringDecryptor>();
            var connection = ConnectionStringResolver.ResolveAdmin(configuration);
            services.AddTammaData(connection, controlPlaneConnectionString: null);
            services.AddTenantConnectionPool(configuration, controlPlaneConnectionString: null);
            await using var provider = services.BuildServiceProvider();
            var source = new EfLocalExportSource(
                configuration,
                provider.GetRequiredService<Microsoft.EntityFrameworkCore.IDbContextFactory<ControlPlaneDbContext>>(),
                provider.GetRequiredService<ITenantDbContextFactory>());
            var result = await new LocalExportService().ExportAsync(
                source,
                output,
                signer,
                overwrite: args.Contains("--force", StringComparer.Ordinal),
                shutdown.Token).ConfigureAwait(false);
            Console.WriteLine(
                "export-local: OK format={0} rows={1} user={2} tenant={3}",
                LocalExportFormat.Name, result.RowCount, result.UserId, result.TenantId);
            return 0;
        }
        catch (LocalExportException ex)
        {
            Console.Error.WriteLine("{0}: FAILED [{1}]. {2}", args[0], ex.Code, ex.Message);
            return 1;
        }
        catch (OperationCanceledException)
        {
            Console.Error.WriteLine("{0}: FAILED [EXPORT.CANCELLED]. No archive was published.", args[0]);
            return 1;
        }
        catch
        {
            Console.Error.WriteLine("{0}: FAILED [EXPORT.FAILED]. No archive was published.", args[0]);
            return 1;
        }
        finally
        {
            Console.CancelKeyPress -= cancel;
        }
    }

    private static string RequiredOption(string[] args, string name) =>
        Option(args, name)
        ?? throw new LocalExportException("EXPORT.ARGUMENTS.INVALID", $"Missing required option {name}.");

    private static string? Option(string[] args, string name)
    {
        for (var i = 1; i < args.Length; i++)
        {
            if (args[i].Equals(name, StringComparison.Ordinal) && i + 1 < args.Length)
            {
                return args[i + 1];
            }
        }
        return null;
    }
}
