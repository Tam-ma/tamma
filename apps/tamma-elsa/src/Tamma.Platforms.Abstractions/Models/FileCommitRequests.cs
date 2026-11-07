namespace Tamma.Platforms.Abstractions.Models;

/// <summary>
/// Story 40-1 AC7 — one file in a <see cref="CommitFilesRequest"/>. The
/// bytes are written verbatim (the driver does no encoding transform).
/// </summary>
/// <param name="Path">Repo-relative path, forward slashes, no leading slash.</param>
/// <param name="Content">The file's exact bytes.</param>
/// <param name="Executable">Commit with the executable bit (git mode
/// <c>100755</c>) instead of <c>100644</c>. Shell scripts a workflow runs
/// directly need it.</param>
public sealed record CommitFileChange(string Path, byte[] Content, bool Executable = false);

/// <summary>
/// Story 40-1 AC7 — input for <see cref="IGitPlatformClient.CommitFilesAsync"/>:
/// create or replace <see cref="Files"/> on top of <see cref="Branch"/>'s tip
/// as ONE commit, then advance the branch (fast-forward only).
/// </summary>
/// <param name="Owner">Repo owner.</param>
/// <param name="RepoName">Repo name.</param>
/// <param name="Branch">Existing branch to commit onto.</param>
/// <param name="Message">Commit message.</param>
/// <param name="Files">The files to create or replace. Must be non-empty.</param>
public sealed record CommitFilesRequest(
    string Owner,
    string RepoName,
    string Branch,
    string Message,
    IReadOnlyList<CommitFileChange> Files);

/// <summary>The commit <see cref="IGitPlatformClient.CommitFilesAsync"/> created.</summary>
/// <param name="Sha">The new commit's SHA (the branch's new tip).</param>
/// <param name="HtmlUrl">Browser URL of the commit, when the platform returns one.</param>
public sealed record FileCommit(string Sha, string? HtmlUrl);
