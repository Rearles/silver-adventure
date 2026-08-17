using DynastyTools.Models;

namespace DynastyTools.Editing;

public sealed record MergeResult(int Added, int Updated, List<string> Notes);

/// <summary>
/// Merges imported people into an existing world, matching on id.
/// </summary>
/// <remarks>
/// <para>
/// The critical rule: <see cref="Person.GmNotes"/> on an existing person is
/// <strong>preserved</strong>. The CSV format has no columns for GM prep, so an
/// import that overwrote the whole record would silently destroy every dossier the
/// GM had written — the most expensive data in the file and the least replaceable.
/// </para>
/// <para>
/// Spouse links are made symmetric afterwards, mirroring what the Angular app does
/// on every edit, so a one-sided marriage typed into a spreadsheet still renders.
/// </para>
/// </remarks>
public static class WorldMerger
{
    public static MergeResult Merge(WorldPeopleFile world, IReadOnlyList<Person> incoming)
    {
        var notes = new List<string>();
        var byId = world.People.ToDictionary(person => person.Id, StringComparer.Ordinal);
        var added = 0;
        var updated = 0;

        foreach (var candidate in incoming)
        {
            if (byId.TryGetValue(candidate.Id, out var existing))
            {
                if (existing.GmNotes is not null)
                {
                    notes.Add($"{existing.Id} ({existing.Name}): kept existing GM dossier.");
                }

                // Copy every CSV-expressible field; leave GmNotes alone.
                existing.Name = candidate.Name;
                existing.House = candidate.House;
                existing.Nation = candidate.Nation;
                existing.Title = candidate.Title;
                existing.BirthYear = candidate.BirthYear;
                existing.DeathYear = candidate.DeathYear;
                existing.IsAlive = candidate.IsAlive;
                existing.ParentIds = candidate.ParentIds;
                existing.SpouseIds = candidate.SpouseIds;
                existing.SuccessionOrder = candidate.SuccessionOrder;
                existing.Notes = candidate.Notes;
                existing.Tags = candidate.Tags;
                existing.Generation = candidate.Generation;
                existing.Visibility = candidate.Visibility;
                existing.HideParentage = candidate.HideParentage;

                updated += 1;
            }
            else
            {
                world.People.Add(candidate);
                byId[candidate.Id] = candidate;
                added += 1;
            }
        }

        NormalizeSpouses(world);
        return new MergeResult(added, Updated: updated, Notes: notes);
    }

    /// <summary>
    /// Makes spouse links symmetric and drops self-references, duplicates, and ids
    /// that point at nobody. Mirrors <c>normalizePool</c> in the Angular app.
    /// </summary>
    public static void NormalizeSpouses(WorldPeopleFile world)
    {
        var ids = world.People.Select(person => person.Id).ToHashSet(StringComparer.Ordinal);
        var spouseSets = world.People.ToDictionary(
            person => person.Id,
            _ => new HashSet<string>(StringComparer.Ordinal),
            StringComparer.Ordinal);

        foreach (var person in world.People)
        {
            foreach (var spouseId in person.SpouseIds)
            {
                if (spouseId == person.Id || !ids.Contains(spouseId))
                {
                    continue;
                }
                spouseSets[person.Id].Add(spouseId);
                spouseSets[spouseId].Add(person.Id);
            }
        }

        foreach (var person in world.People)
        {
            person.SpouseIds = [.. spouseSets[person.Id]];
            person.ParentIds = [.. person.ParentIds
                .Distinct(StringComparer.Ordinal)
                .Where(parentId => parentId != person.Id && ids.Contains(parentId))
                .Take(2)];
        }
    }
}
