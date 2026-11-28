using System.Security.Cryptography;
using System.Text;
using Org.BouncyCastle.Crypto.Parameters;
using Org.BouncyCastle.Crypto.Signers;

namespace Tamma.Api.Services.LocalExport;

internal sealed class LocalExportSigner
{
    private readonly Ed25519PrivateKeyParameters _privateKey;

    private LocalExportSigner(Ed25519PrivateKeyParameters privateKey)
    {
        _privateKey = privateKey;
        PublicKey = privateKey.GeneratePublicKey().GetEncoded();
        KeyId = Convert.ToHexString(SHA256.HashData(PublicKey)).ToLowerInvariant();
    }

    public byte[] PublicKey { get; }
    public string KeyId { get; }

    public static LocalExportSigner FromSeed(byte[] seed)
    {
        if (seed.Length != 32)
        {
            throw new LocalExportException("EXPORT.KEY.INVALID", "Export signing key must be a 32-byte Ed25519 seed.");
        }

        return new LocalExportSigner(new Ed25519PrivateKeyParameters(seed, 0));
    }

    public static LocalExportSigner FromFile(string path)
    {
        return FromSeed(ReadKeyFile(path, "EXPORT.KEY.INVALID"));
    }

    public byte[] Sign(byte[] manifestBytes)
    {
        var signer = new Ed25519Signer();
        signer.Init(true, _privateKey);
        signer.BlockUpdate(manifestBytes, 0, manifestBytes.Length);
        return signer.GenerateSignature();
    }

    public static string ComputeKeyId(byte[] publicKey)
    {
        if (publicKey.Length != 32)
        {
            throw new LocalExportException("VERIFY.KEY.INVALID", "Trusted public key must be 32 bytes.");
        }

        return Convert.ToHexString(SHA256.HashData(publicKey)).ToLowerInvariant();
    }

    public static bool Verify(byte[] publicKey, byte[] manifestBytes, byte[] signature)
    {
        if (publicKey.Length != 32 || signature.Length != 64)
        {
            return false;
        }

        var verifier = new Ed25519Signer();
        verifier.Init(false, new Ed25519PublicKeyParameters(publicKey, 0));
        verifier.BlockUpdate(manifestBytes, 0, manifestBytes.Length);
        return verifier.VerifySignature(signature);
    }

    public static byte[] ReadTrustedPublicKeyFile(string path) =>
        ReadKeyFile(path, "VERIFY.KEY.INVALID");

    private static byte[] ReadKeyFile(string path, string errorCode)
    {
        try
        {
            var text = File.ReadAllText(path, Encoding.UTF8).Trim();
            return Convert.FromBase64String(text);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or FormatException)
        {
            throw new LocalExportException(errorCode, "Export key file is missing, unreadable, or not base64.");
        }
    }
}
