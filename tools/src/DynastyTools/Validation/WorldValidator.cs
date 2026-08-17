using DynastyTools.Models;

namespace DynastyTools.Validation;

public enum Severity
{
    /// <summary>Breaks the data model; the app may misbehave.</summary>
    Error,

    /// <summary>Suspicious but legal — often intentional in a fictional setting.</summary>
    Warning,
}

public sealed record Finding(Severity Severity, string Code, string Subject, string Message)
{
    public override string ToString() =>
        $"{(Severity == Severity.Error ? "ERROR" : "WARN ")}  {Code,-22} {Subject,-10} {Message}";
}

/// <summary>
/// Checks a world for structural problems.
/// </summary>
/// <remarks>
/// The severity split matters for a fiction-authoring tool. A dangling parent id is
/// an <see cref="Severity.Error"/> — the app cannot draw it. A child born before its
/// parent is only a <see cref="Severity.Warning"/>: it is almost certainly a typo,
/// but this is a setting where a GM may have deliberate reasons, so the tool
/// reports it rather than refusing the file.
/// </remarks>
public static class WorldValidator
{
    private static readonly string[] ValidVisibilities = ["known", "hidden"];

    public static List<Finding> Validate(
        WorldPeopleFile world,
        WorldEventsFile? events = null)
    {
        var findings = new List<Finding>();
        var people = world.People;

        ValidateIdentity(people, findings);

        // Build the lookup only from unique ids so later checks are unambiguous.
        var byId = new Dictionary<string, Person>();
        foreach (var person in people)
        {
            byId.TryAdd(person.Id, person);
        }

        ValidateFields(people, findings);
        ValidateRelationships(people, byId, findings);
        ValidateChronology(people, byId, findings);
        ValidateGenerations(people, byId, findings);
        ValidateParentageCycles(people, byId, findings);

        if (events is not null)
        {
            ValidateEvents(events.Events, byId, findings);
        }

        return findings;
    }

    private static void ValidateIdentity(List<Person> people, List<Finding> findings)
    {
        var seen = new HashSet<string>();
        foreach (var person in people)
        {
            if (string.IsNullOrWhiteSpace(person.Id))
            {
                findings.Add(new Finding(Severity.Error, "missing-id", "-",
                    $"A person ('{person.Name}') has no id."));
                continue;
            }

            if (!seen.Add(person.Id))
            {
                findings.Add(new Finding(Severity.Error, "duplicate-id", person.Id,
                    $"Duplicate id — '{person.Name}' reuses an existing id."));
            }
        }
    }

    private static void ValidateFields(List<Person> people, List<Finding> findings)
    {
        foreach (var person in people)
        {
            if (string.IsNullOrWhiteSpace(person.Name))
            {
                findings.Add(new Finding(Severity.Error, "missing-name", person.Id,
                    "Person has no name."));
            }

            if (string.IsNullOrWhiteSpace(person.House))
            {
                findings.Add(new Finding(Severity.Warning, "missing-house", person.Id,
                    $"'{person.Name}' has no house; house filters will not find them."));
            }

            if (string.IsNullOrWhiteSpace(person.Nation))
            {
                findings.Add(new Finding(Severity.Warning, "missing-nation", person.Id,
                    $"'{person.Name}' has no nation; nation filters will not find them."));
            }

            if (!ValidVisibilities.Contains(person.Visibility))
            {
                findings.Add(new Finding(Severity.Error, "bad-visibility", person.Id,
                    $"visibility '{person.Visibility}' is not 'known' or 'hidden'."));
            }

            if (person.ParentIds.Count > 2)
            {
                findings.Add(new Finding(Severity.Error, "too-many-parents", person.Id,
                    $"'{person.Name}' has {person.ParentIds.Count} parents; the model allows at most 2."));
            }

            if (person.IsAlive && person.DeathYear is not null)
            {
                findings.Add(new Finding(Severity.Warning, "alive-with-death", person.Id,
                    $"'{person.Name}' is marked living but has a death year ({person.DeathYear})."));
            }

            if (!person.IsAlive && person.DeathYear is null)
            {
                findings.Add(new Finding(Severity.Warning, "dead-without-death", person.Id,
                    $"'{person.Name}' is marked deceased but has no death year."));
            }

            if (person.HideParentage && person.ParentIds.Count == 0)
            {
                findings.Add(new Finding(Severity.Warning, "pointless-hideparentage", person.Id,
                    $"'{person.Name}' has hideParentage set but no parents to hide."));
            }
        }
    }

    private static void ValidateRelationships(
        List<Person> people,
        Dictionary<string, Person> byId,
        List<Finding> findings)
    {
        foreach (var person in people)
        {
            foreach (var parentId in person.ParentIds)
            {
                if (parentId == person.Id)
                {
                    findings.Add(new Finding(Severity.Error, "self-parent", person.Id,
                        $"'{person.Name}' is listed as their own parent."));
                }
                else if (!byId.ContainsKey(parentId))
                {
                    findings.Add(new Finding(Severity.Error, "dangling-parent", person.Id,
                        $"parentIds references '{parentId}', who does not exist."));
                }
            }

            if (person.ParentIds.Count != person.ParentIds.Distinct().Count())
            {
                findings.Add(new Finding(Severity.Error, "duplicate-parent", person.Id,
                    $"'{person.Name}' lists the same parent twice."));
            }

            foreach (var spouseId in person.SpouseIds)
            {
                if (spouseId == person.Id)
                {
                    findings.Add(new Finding(Severity.Error, "self-spouse", person.Id,
                        $"'{person.Name}' is married to themselves."));
                    continue;
                }

                if (!byId.TryGetValue(spouseId, out var spouse))
                {
                    findings.Add(new Finding(Severity.Error, "dangling-spouse", person.Id,
                        $"spouseIds references '{spouseId}', who does not exist."));
                    continue;
                }

                // The app repairs this on edit, but a hand-edited or imported file
                // can carry a one-sided marriage, which renders no spouse bar.
                if (!spouse.SpouseIds.Contains(person.Id))
                {
                    findings.Add(new Finding(Severity.Error, "asymmetric-marriage", person.Id,
                        $"'{person.Name}' lists '{spouse.Name}' as a spouse, but not the reverse."));
                }
            }
        }
    }

    private static void ValidateChronology(
        List<Person> people,
        Dictionary<string, Person> byId,
        List<Finding> findings)
    {
        foreach (var person in people)
        {
            if (person.BirthYear is int birth && person.DeathYear is int death && death < birth)
            {
                findings.Add(new Finding(Severity.Error, "death-before-birth", person.Id,
                    $"'{person.Name}' dies in {death} but is born in {birth}."));
            }

            if (person.BirthYear is not int childBirth)
            {
                continue;
            }

            foreach (var parentId in person.ParentIds)
            {
                if (!byId.TryGetValue(parentId, out var parent))
                {
                    continue;
                }

                if (parent.BirthYear is int parentBirth && childBirth <= parentBirth)
                {
                    findings.Add(new Finding(Severity.Warning, "child-before-parent", person.Id,
                        $"'{person.Name}' ({childBirth}) is born no later than parent '{parent.Name}' ({parentBirth})."));
                }

                // A child arriving long after a parent's death is usually a typo.
                // One year of grace covers a posthumous birth.
                if (parent.DeathYear is int parentDeath && childBirth > parentDeath + 1)
                {
                    findings.Add(new Finding(Severity.Warning, "child-after-parent-death", person.Id,
                        $"'{person.Name}' ({childBirth}) is born after parent '{parent.Name}' died ({parentDeath})."));
                }
            }
        }
    }

    private static void ValidateGenerations(
        List<Person> people,
        Dictionary<string, Person> byId,
        List<Finding> findings)
    {
        foreach (var person in people)
        {
            foreach (var parentId in person.ParentIds)
            {
                if (!byId.TryGetValue(parentId, out var parent))
                {
                    continue;
                }

                if (person.Generation != parent.Generation + 1)
                {
                    findings.Add(new Finding(Severity.Warning, "generation-gap", person.Id,
                        $"'{person.Name}' is generation {person.Generation}; parent '{parent.Name}' is {parent.Generation} "
                        + $"(expected {parent.Generation + 1}). The tree will draw them off-row."));
                }
            }
        }
    }

    /// <summary>
    /// Detects ancestry loops (A is their own ancestor), which would otherwise make
    /// the tree layout unresolvable.
    /// </summary>
    private static void ValidateParentageCycles(
        List<Person> people,
        Dictionary<string, Person> byId,
        List<Finding> findings)
    {
        // 0 = unvisited, 1 = on the current path, 2 = fully explored.
        var state = new Dictionary<string, int>();
        var reported = new HashSet<string>();

        bool Walk(string id, List<string> path)
        {
            if (state.TryGetValue(id, out var mark))
            {
                if (mark == 1)
                {
                    var loopStart = path.IndexOf(id);
                    var loop = loopStart >= 0 ? path[loopStart..] : [id];
                    var key = string.Join(">", loop.Order());
                    if (reported.Add(key))
                    {
                        findings.Add(new Finding(Severity.Error, "parentage-cycle", id,
                            $"Ancestry loop: {string.Join(" → ", loop)} → {id}."));
                    }
                    return true;
                }

                if (mark == 2)
                {
                    return false;
                }
            }

            state[id] = 1;
            path.Add(id);

            if (byId.TryGetValue(id, out var person))
            {
                foreach (var parentId in person.ParentIds)
                {
                    if (parentId != id && byId.ContainsKey(parentId))
                    {
                        Walk(parentId, path);
                    }
                }
            }

            path.RemoveAt(path.Count - 1);
            state[id] = 2;
            return false;
        }

        foreach (var person in people)
        {
            if (!string.IsNullOrWhiteSpace(person.Id) && !state.ContainsKey(person.Id))
            {
                Walk(person.Id, []);
            }
        }
    }

    private static void ValidateEvents(
        List<DynastyEvent> events,
        Dictionary<string, Person> byId,
        List<Finding> findings)
    {
        var seen = new HashSet<string>();

        foreach (var dynastyEvent in events)
        {
            if (string.IsNullOrWhiteSpace(dynastyEvent.Id))
            {
                findings.Add(new Finding(Severity.Error, "missing-event-id", "-",
                    $"Event '{dynastyEvent.Title}' has no id."));
            }
            else if (!seen.Add(dynastyEvent.Id))
            {
                findings.Add(new Finding(Severity.Error, "duplicate-event-id", dynastyEvent.Id,
                    $"Duplicate event id — '{dynastyEvent.Title}' reuses an existing id."));
            }

            if (string.IsNullOrWhiteSpace(dynastyEvent.Title))
            {
                findings.Add(new Finding(Severity.Error, "missing-event-title", dynastyEvent.Id,
                    "Event has no title."));
            }

            if (!DynastyEvent.ValidTypes.Contains(dynastyEvent.Type))
            {
                findings.Add(new Finding(Severity.Error, "bad-event-type", dynastyEvent.Id,
                    $"type '{dynastyEvent.Type}' is not one of: {string.Join(", ", DynastyEvent.ValidTypes)}."));
            }

            if (!ValidVisibilities.Contains(dynastyEvent.Visibility))
            {
                findings.Add(new Finding(Severity.Error, "bad-event-visibility", dynastyEvent.Id,
                    $"visibility '{dynastyEvent.Visibility}' is not 'known' or 'hidden'."));
            }

            foreach (var personId in dynastyEvent.RelatedPersonIds)
            {
                if (!byId.ContainsKey(personId))
                {
                    findings.Add(new Finding(Severity.Error, "dangling-event-person", dynastyEvent.Id,
                        $"relatedPersonIds references '{personId}', who does not exist."));
                }
            }

            // A public event about a secret person leaks that person's existence to
            // players through the timeline. The app's projection scrubs the id, but
            // the event title often names them, so flag it for the GM to review.
            var hiddenParticipants = dynastyEvent.RelatedPersonIds
                .Where(id => byId.TryGetValue(id, out var person) && person.Visibility == "hidden")
                .ToList();

            if (dynastyEvent.Visibility == "known" && hiddenParticipants.Count > 0)
            {
                var names = hiddenParticipants
                    .Select(id => byId[id].Name)
                    .ToList();
                findings.Add(new Finding(Severity.Warning, "known-event-hidden-person", dynastyEvent.Id,
                    $"Player-visible event '{dynastyEvent.Title}' involves hidden {string.Join(", ", names)}. "
                    + "Check the title and description do not name them."));
            }
        }
    }
}
