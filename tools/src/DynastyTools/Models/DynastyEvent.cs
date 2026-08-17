namespace DynastyTools.Models;

/// <summary>
/// One dated happening, cross-linked to people by id. Mirrors the Angular
/// <c>DynastyEvent</c> interface.
/// </summary>
public sealed class DynastyEvent
{
    public string Id { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;

    /// <summary>
    /// Kept as a string so an unrecognised type is a validation finding rather
    /// than a deserialization crash. See <see cref="ValidTypes"/>.
    /// </summary>
    public string Type { get; set; } = "other";

    public int Year { get; set; }
    public string? Era { get; set; }
    public string? Description { get; set; }
    public List<string> RelatedPersonIds { get; set; } = [];
    public string? Nation { get; set; }
    public string? House { get; set; }
    public string Visibility { get; set; } = "known";

    public static readonly string[] ValidTypes =
    [
        "birth",
        "death",
        "coronation",
        "wedding",
        "war",
        "battle",
        "treaty",
        "other",
    ];
}

/// <summary>Shape of <c>data/{world}-events.json</c>.</summary>
public sealed class WorldEventsFile
{
    public List<DynastyEvent> Events { get; set; } = [];
}
