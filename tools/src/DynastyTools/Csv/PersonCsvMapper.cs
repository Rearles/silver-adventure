using System.Globalization;
using DynastyTools.Models;

namespace DynastyTools.Csv;

public sealed record CsvMapResult(List<Person> People, List<string> Problems);

/// <summary>
/// Maps CSV records onto <see cref="Person"/> objects.
/// </summary>
/// <remarks>
/// List-valued columns (<c>parentIds</c>, <c>spouseIds</c>, <c>tags</c>) are
/// semicolon-separated, because the field separator is already a comma and a GM
/// authoring in a spreadsheet should not have to quote every multi-parent cell.
/// </remarks>
public static class PersonCsvMapper
{
    public const string ListSeparator = ";";

    /// <summary>Columns the importer understands, for the help text and docs.</summary>
    public static readonly string[] KnownColumns =
    [
        "id", "name", "house", "nation", "title", "birthYear", "deathYear",
        "isAlive", "parentIds", "spouseIds", "successionOrder", "notes",
        "tags", "generation", "visibility", "hideParentage",
    ];

    public static CsvMapResult Map(List<Dictionary<string, string>> records)
    {
        var people = new List<Person>();
        var problems = new List<string>();

        for (var index = 0; index < records.Count; index += 1)
        {
            var record = records[index];
            // +2: one for the header row, one for 1-based line numbering.
            var line = index + 2;

            var name = Get(record, "name");
            if (string.IsNullOrWhiteSpace(name))
            {
                problems.Add($"line {line}: skipped — no name.");
                continue;
            }

            var person = new Person
            {
                Id = Get(record, "id"),
                Name = name,
                House = Get(record, "house"),
                Nation = Get(record, "nation"),
                Title = NullIfBlank(Get(record, "title")),
                Notes = NullIfBlank(Get(record, "notes")),
                ParentIds = SplitList(Get(record, "parentIds")),
                SpouseIds = SplitList(Get(record, "spouseIds")),
                Visibility = NormalizeVisibility(Get(record, "visibility"), line, problems),
            };

            var tags = SplitList(Get(record, "tags"));
            person.Tags = tags.Count > 0 ? tags : null;

            if (TryParseInt(record, "birthYear", line, problems, out var birthYear))
            {
                person.BirthYear = birthYear;
            }

            if (TryParseInt(record, "deathYear", line, problems, out var deathYear))
            {
                person.DeathYear = deathYear;
            }

            if (TryParseInt(record, "successionOrder", line, problems, out var succession))
            {
                person.SuccessionOrder = succession;
            }

            if (TryParseInt(record, "generation", line, problems, out var generation))
            {
                person.Generation = generation ?? 0;
            }

            // isAlive defaults to "no death year recorded" when the column is absent,
            // which is the sensible reading of a partially filled spreadsheet.
            var isAliveRaw = Get(record, "isAlive");
            person.IsAlive = string.IsNullOrWhiteSpace(isAliveRaw)
                ? person.DeathYear is null
                : ParseBool(isAliveRaw, line, "isAlive", problems);

            person.HideParentage = ParseBool(Get(record, "hideParentage"), line, "hideParentage", problems);

            people.Add(person);
        }

        AssignMissingIds(people);
        return new CsvMapResult(people, problems);
    }

    /// <summary>
    /// Gives every id-less row a fresh <c>p{n}</c> id that does not collide with an
    /// id already used in the same import.
    /// </summary>
    private static void AssignMissingIds(List<Person> people)
    {
        var taken = people
            .Where(person => !string.IsNullOrWhiteSpace(person.Id))
            .Select(person => person.Id)
            .ToHashSet(StringComparer.Ordinal);

        var next = 1;
        foreach (var person in people.Where(p => string.IsNullOrWhiteSpace(p.Id)))
        {
            while (taken.Contains($"p{next}"))
            {
                next += 1;
            }
            person.Id = $"p{next}";
            taken.Add(person.Id);
        }
    }

    private static string Get(Dictionary<string, string> record, string column) =>
        record.TryGetValue(column, out var value) ? value.Trim() : string.Empty;

    private static string? NullIfBlank(string value) =>
        string.IsNullOrWhiteSpace(value) ? null : value;

    public static List<string> SplitList(string value) =>
        string.IsNullOrWhiteSpace(value)
            ? []
            : [.. value
                .Split(ListSeparator, StringSplitOptions.RemoveEmptyEntries)
                .Select(entry => entry.Trim())
                .Where(entry => entry.Length > 0)];

    private static string NormalizeVisibility(string raw, int line, List<string> problems)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return "known";
        }

        var normalized = raw.ToLowerInvariant();
        if (normalized is "known" or "hidden")
        {
            return normalized;
        }

        problems.Add($"line {line}: visibility '{raw}' is not 'known' or 'hidden'; defaulted to 'known'.");
        return "known";
    }

    private static bool TryParseInt(
        Dictionary<string, string> record,
        string column,
        int line,
        List<string> problems,
        out int? value)
    {
        value = null;
        var raw = Get(record, column);
        if (string.IsNullOrWhiteSpace(raw))
        {
            return false;
        }

        if (int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed))
        {
            value = parsed;
            return true;
        }

        problems.Add($"line {line}: {column} '{raw}' is not a whole number; left unset.");
        return false;
    }

    private static bool ParseBool(string raw, int line, string column, List<string> problems)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return false;
        }

        switch (raw.ToLowerInvariant())
        {
            case "true" or "yes" or "y" or "1":
                return true;
            case "false" or "no" or "n" or "0":
                return false;
            default:
                problems.Add($"line {line}: {column} '{raw}' is not a yes/no value; treated as false.");
                return false;
        }
    }
}
