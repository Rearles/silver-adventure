using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using DynastyTools.Models;

namespace DynastyTools.Serialization;

/// <summary>
/// Loads and saves world files in exactly the shape the Angular app expects:
/// camelCase properties, two-space indentation, absent (rather than null)
/// optional fields, and a trailing newline.
/// </summary>
/// <remarks>
/// Keeping the writer byte-compatible with the app's own
/// <c>JSON.stringify(file, null, 2)</c> output matters: the GM edits the same files
/// from both sides, and a formatting mismatch would produce noisy diffs on every
/// round trip.
/// </remarks>
public static class WorldJson
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        // System.Text.Json indents with two spaces, matching JSON.stringify(x, null, 2).
        WriteIndented = true,
        // Match JSON.stringify, which does not escape non-ASCII or HTML characters.
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
    };

    public static WorldPeopleFile LoadPeople(string path)
    {
        var json = File.ReadAllText(path);
        var file = JsonSerializer.Deserialize<WorldPeopleFile>(json, Options)
            ?? throw new InvalidDataException($"{path} did not contain a world object.");
        return file;
    }

    public static WorldEventsFile LoadEvents(string path)
    {
        var json = File.ReadAllText(path);
        var file = JsonSerializer.Deserialize<WorldEventsFile>(json, Options)
            ?? throw new InvalidDataException($"{path} did not contain an events object.");
        return file;
    }

    public static string SerializePeople(WorldPeopleFile file) =>
        JsonSerializer.Serialize(file, Options) + Environment.NewLine;

    public static string SerializeEvents(WorldEventsFile file) =>
        JsonSerializer.Serialize(file, Options) + Environment.NewLine;

    public static void SavePeople(string path, WorldPeopleFile file) =>
        File.WriteAllText(path, SerializePeople(file));

    public static void SaveEvents(string path, WorldEventsFile file) =>
        File.WriteAllText(path, SerializeEvents(file));

    /// <summary>
    /// Derives the events path that pairs with a people path:
    /// <c>data/astyria.json</c> → <c>data/astyria-events.json</c>.
    /// </summary>
    public static string EventsPathFor(string peoplePath)
    {
        var directory = Path.GetDirectoryName(peoplePath) ?? string.Empty;
        var world = Path.GetFileNameWithoutExtension(peoplePath);
        return Path.Combine(directory, $"{world}-events.json");
    }
}
