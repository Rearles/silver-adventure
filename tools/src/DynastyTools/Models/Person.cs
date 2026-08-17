namespace DynastyTools.Models;

/// <summary>
/// GM-only character prep. Mirrors the <c>GmNotes</c> interface in the Angular app.
/// The tools read and write this faithfully; only the app's player projection strips it.
/// </summary>
public sealed class GmNotes
{
    public List<string>? PersonalityTraits { get; set; }
    public string? PhysicalDescription { get; set; }
    public List<string>? Allies { get; set; }
    public List<string>? Enemies { get; set; }
    public string? Motivations { get; set; }
    public string? Goals { get; set; }
    public string? Ambitions { get; set; }
    public string? Secrets { get; set; }
}

/// <summary>
/// One person in a world file.
/// </summary>
/// <remarks>
/// <see cref="Visibility"/> is a plain string rather than an enum on purpose: a
/// validator has to be able to <em>report</em> an unrecognised value, which is
/// impossible if deserialization throws on it first.
/// </remarks>
public sealed class Person
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string House { get; set; } = string.Empty;
    public string Nation { get; set; } = string.Empty;
    public string? Title { get; set; }
    public int? BirthYear { get; set; }
    public int? DeathYear { get; set; }
    public bool IsAlive { get; set; }
    public List<string> ParentIds { get; set; } = [];
    public List<string> SpouseIds { get; set; } = [];
    public int? SuccessionOrder { get; set; }
    public string? Notes { get; set; }
    public List<string>? Tags { get; set; }
    public int Generation { get; set; }
    public string Visibility { get; set; } = "known";
    public bool HideParentage { get; set; }
    public GmNotes? GmNotes { get; set; }
}

/// <summary>Shape of <c>data/{world}.json</c>.</summary>
public sealed class WorldPeopleFile
{
    public List<Person> People { get; set; } = [];
}
