using System.Globalization;
using DynastyTools.Models;

namespace DynastyTools.Editing;

/// <summary>Which people a bulk edit applies to. Every set field must match.</summary>
public sealed record BulkEditSelector(
    string? House = null,
    string? Nation = null,
    string? Tag = null,
    int? Generation = null,
    string? Visibility = null,
    IReadOnlyCollection<string>? Ids = null)
{
    public bool IsEmpty =>
        House is null && Nation is null && Tag is null
        && Generation is null && Visibility is null && (Ids is null || Ids.Count == 0);

    public bool Matches(Person person)
    {
        if (House is not null && !string.Equals(person.House, House, StringComparison.OrdinalIgnoreCase))
            return false;
        if (Nation is not null && !string.Equals(person.Nation, Nation, StringComparison.OrdinalIgnoreCase))
            return false;
        if (Visibility is not null && !string.Equals(person.Visibility, Visibility, StringComparison.OrdinalIgnoreCase))
            return false;
        if (Generation is not null && person.Generation != Generation)
            return false;
        if (Tag is not null && (person.Tags is null || !person.Tags.Contains(Tag, StringComparer.OrdinalIgnoreCase)))
            return false;
        if (Ids is not null && Ids.Count > 0 && !Ids.Contains(person.Id))
            return false;
        return true;
    }
}

public sealed record BulkEditResult(
    int Matched,
    List<string> Changes,
    List<string> Problems);

/// <summary>
/// Applies field assignments across a filtered selection of people.
/// </summary>
/// <remarks>
/// Separated from the CLI so it can be unit-tested directly, and so a caller can
/// run it against an in-memory world to preview a change (<c>--dry-run</c>)
/// without touching disk.
/// </remarks>
public static class BulkEditor
{
    public static readonly string[] SettableFields =
    [
        "house", "nation", "title", "visibility", "hideParentage", "isAlive",
        "generation", "successionOrder", "era", "addTag", "removeTag",
    ];

    public static BulkEditResult Apply(
        WorldPeopleFile world,
        BulkEditSelector selector,
        IReadOnlyDictionary<string, string> assignments)
    {
        var changes = new List<string>();
        var problems = new List<string>();

        var unknown = assignments.Keys
            .Where(field => !SettableFields.Contains(field, StringComparer.OrdinalIgnoreCase))
            .ToList();

        foreach (var field in unknown)
        {
            problems.Add($"'{field}' is not a settable field. Known: {string.Join(", ", SettableFields)}.");
        }

        if (problems.Count > 0)
        {
            return new BulkEditResult(0, changes, problems);
        }

        var matched = world.People.Where(selector.Matches).ToList();

        foreach (var person in matched)
        {
            foreach (var (field, rawValue) in assignments)
            {
                ApplyOne(person, field, rawValue, changes, problems);
            }
        }

        return new BulkEditResult(matched.Count, changes, problems);
    }

    private static void ApplyOne(
        Person person,
        string field,
        string rawValue,
        List<string> changes,
        List<string> problems)
    {
        switch (field.ToLowerInvariant())
        {
            case "house":
                Record(changes, person, "house", person.House, rawValue);
                person.House = rawValue;
                break;

            case "nation":
                Record(changes, person, "nation", person.Nation, rawValue);
                person.Nation = rawValue;
                break;

            case "title":
                Record(changes, person, "title", person.Title ?? "(none)", rawValue);
                person.Title = string.IsNullOrWhiteSpace(rawValue) ? null : rawValue;
                break;

            case "visibility":
                var visibility = rawValue.ToLowerInvariant();
                if (visibility is not ("known" or "hidden"))
                {
                    problems.Add($"visibility '{rawValue}' is not 'known' or 'hidden'.");
                    return;
                }
                Record(changes, person, "visibility", person.Visibility, visibility);
                person.Visibility = visibility;
                break;

            case "hideparentage":
                if (!TryParseBool(rawValue, out var hideParentage))
                {
                    problems.Add($"hideParentage '{rawValue}' is not a yes/no value.");
                    return;
                }
                Record(changes, person, "hideParentage", person.HideParentage.ToString(), hideParentage.ToString());
                person.HideParentage = hideParentage;
                break;

            case "isalive":
                if (!TryParseBool(rawValue, out var isAlive))
                {
                    problems.Add($"isAlive '{rawValue}' is not a yes/no value.");
                    return;
                }
                Record(changes, person, "isAlive", person.IsAlive.ToString(), isAlive.ToString());
                person.IsAlive = isAlive;
                break;

            case "generation":
                if (!int.TryParse(rawValue, NumberStyles.Integer, CultureInfo.InvariantCulture, out var generation))
                {
                    problems.Add($"generation '{rawValue}' is not a whole number.");
                    return;
                }
                Record(changes, person, "generation", person.Generation.ToString(CultureInfo.InvariantCulture),
                    generation.ToString(CultureInfo.InvariantCulture));
                person.Generation = generation;
                break;

            case "successionorder":
                if (string.IsNullOrWhiteSpace(rawValue))
                {
                    Record(changes, person, "successionOrder", person.SuccessionOrder?.ToString(CultureInfo.InvariantCulture) ?? "(none)", "(none)");
                    person.SuccessionOrder = null;
                    return;
                }
                if (!int.TryParse(rawValue, NumberStyles.Integer, CultureInfo.InvariantCulture, out var succession))
                {
                    problems.Add($"successionOrder '{rawValue}' is not a whole number.");
                    return;
                }
                Record(changes, person, "successionOrder",
                    person.SuccessionOrder?.ToString(CultureInfo.InvariantCulture) ?? "(none)",
                    succession.ToString(CultureInfo.InvariantCulture));
                person.SuccessionOrder = succession;
                break;

            case "addtag":
                person.Tags ??= [];
                if (person.Tags.Contains(rawValue, StringComparer.OrdinalIgnoreCase))
                {
                    return;
                }
                person.Tags.Add(rawValue);
                changes.Add($"{person.Id} ({person.Name}): +tag '{rawValue}'");
                break;

            case "removetag":
                if (person.Tags is null)
                {
                    return;
                }
                var removed = person.Tags.RemoveAll(tag => string.Equals(tag, rawValue, StringComparison.OrdinalIgnoreCase));
                if (removed > 0)
                {
                    changes.Add($"{person.Id} ({person.Name}): -tag '{rawValue}'");
                }
                // Drop an emptied list so the JSON keeps omitting the field.
                if (person.Tags.Count == 0)
                {
                    person.Tags = null;
                }
                break;

            default:
                problems.Add($"'{field}' is not a settable field.");
                break;
        }
    }

    private static void Record(List<string> changes, Person person, string field, string before, string after)
    {
        if (before == after)
        {
            return;
        }
        changes.Add($"{person.Id} ({person.Name}): {field} '{before}' → '{after}'");
    }

    private static bool TryParseBool(string raw, out bool value)
    {
        switch (raw.ToLowerInvariant())
        {
            case "true" or "yes" or "y" or "1":
                value = true;
                return true;
            case "false" or "no" or "n" or "0":
                value = false;
                return true;
            default:
                value = false;
                return false;
        }
    }
}
