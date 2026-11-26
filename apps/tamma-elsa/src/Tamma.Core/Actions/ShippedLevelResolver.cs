namespace Tamma.Core.Actions;

/// <summary>
/// Story 43-18 — THE single resolver seam for effective shipped action levels:
/// <c>EffectiveShippedLevel(key) = override ?? descriptor.DefaultMinAutonomy</c>.
///
/// <para>Every level reader in the codebase — the autonomy gate evaluator's
/// shipped-default rung and degraded fallback, Story 43-15's <c>levelOwned</c>
/// predicate / detent set / diff preview, Story 43-16's derived document-type
/// acceptor floor, and the policy/catalog admin views — reads through this seam
/// so no two surfaces can ever disagree about what level an action sits at.
/// Enforced by the Story 43-18 AC9 single-source architecture test.</para>
/// </summary>
public interface IShippedLevelResolver
{
    /// <summary>Provenance wire when the catalog's shipped constant applies.</summary>
    public const string SourceShipped = "shipped";

    /// <summary>Provenance wire when a platform <c>action_level_overrides</c> row wins.</summary>
    public const string SourceOverride = "override";

    /// <summary>
    /// The unmodified shipped constant from <see cref="ActionCatalog"/> (including
    /// Story 42-10's startup sandbox profile for shell/process.spawn). Used for
    /// provenance views and the 50-line floor validation — never for enforcement.
    /// </summary>
    int ShippedDefault(ActionKey key);

    /// <summary>
    /// The effective shipped level: <c>override ?? ShippedDefault(key)</c>.
    /// </summary>
    int EffectiveShippedLevel(ActionKey key);

    /// <summary>Returns true and the overridden level iff an active platform override exists.</summary>
    bool TryGetOverride(ActionKey key, out int level);

    /// <summary>Provenance wire: <c>"override"</c> when overridden, <c>"shipped"</c> otherwise.</summary>
    string LevelSource(ActionKey key) =>
        TryGetOverride(key, out _) ? SourceOverride : SourceShipped;
}

/// <summary>
/// Pure default <see cref="IShippedLevelResolver"/> with no overrides — always
/// returns <see cref="ActionCatalog"/>'s shipped constant. This class is the
/// ONE production reader of <see cref="ActionDescriptor.DefaultMinAutonomy"/>
/// outside catalog construction (Story 43-18 AC9).
/// </summary>
public sealed class CatalogDefaultShippedLevelResolver : IShippedLevelResolver
{
    public static CatalogDefaultShippedLevelResolver Instance { get; } = new();

    private CatalogDefaultShippedLevelResolver() { }

    /// <inheritdoc />
    public int ShippedDefault(ActionKey key) => ActionCatalog.Get(key).DefaultMinAutonomy;

    /// <inheritdoc />
    public int EffectiveShippedLevel(ActionKey key) => ShippedDefault(key);

    /// <inheritdoc />
    public bool TryGetOverride(ActionKey key, out int level)
    {
        level = default;
        return false;
    }
}

/// <summary>
/// Pure in-memory <see cref="IShippedLevelResolver"/> backed by an immutable
/// <c>actionKeyWire → level</c> map (used for snapshot projections and tests).
/// </summary>
public sealed class DictionaryShippedLevelResolver : IShippedLevelResolver
{
    private readonly IReadOnlyDictionary<string, int> _overrides;

    public DictionaryShippedLevelResolver(IReadOnlyDictionary<string, int>? overrides)
    {
        _overrides = overrides ?? new Dictionary<string, int>(StringComparer.Ordinal);
    }

    /// <inheritdoc />
    public int ShippedDefault(ActionKey key) =>
        CatalogDefaultShippedLevelResolver.Instance.ShippedDefault(key);

    /// <inheritdoc />
    public int EffectiveShippedLevel(ActionKey key) =>
        _overrides.TryGetValue(key.ToWire(), out var level)
            ? level
            : ShippedDefault(key);

    /// <inheritdoc />
    public bool TryGetOverride(ActionKey key, out int level) =>
        _overrides.TryGetValue(key.ToWire(), out level);
}
