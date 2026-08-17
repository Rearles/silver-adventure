using DynastyTools.Csv;
using DynastyTools.Editing;
using DynastyTools.Models;
using DynastyTools.Serialization;
using DynastyTools.Validation;

namespace DynastyTools;

/// <summary>
/// CLI entry point. Three verbs: <c>validate</c>, <c>import</c>, <c>bulk-edit</c>.
/// </summary>
/// <remarks>
/// Argument parsing is hand-rolled to keep the tool dependency-free. Exit codes:
/// 0 = success, 1 = validation errors or a failed operation, 2 = bad usage.
/// </remarks>
public static class Program
{
    public static int Main(string[] args)
    {
        if (args.Length == 0 || args[0] is "-h" or "--help" or "help")
        {
            PrintUsage();
            return args.Length == 0 ? 2 : 0;
        }

        var verb = args[0];
        var options = ParseOptions(args.Skip(1));

        try
        {
            return verb switch
            {
                "validate" => RunValidate(options),
                "import" => RunImport(options),
                "bulk-edit" => RunBulkEdit(options),
                _ => Fail($"Unknown command '{verb}'."),
            };
        }
        catch (FileNotFoundException error)
        {
            Console.Error.WriteLine($"File not found: {error.FileName}");
            return 1;
        }
        catch (Exception error) when (error is InvalidDataException or System.Text.Json.JsonException)
        {
            Console.Error.WriteLine($"Could not read the world file: {error.Message}");
            return 1;
        }
    }

    // ── validate ─────────────────────────────────────────────────────────────

    private static int RunValidate(Options options)
    {
        if (options.World is null)
        {
            return Fail("validate requires --world <path to {world}.json>.");
        }

        var world = WorldJson.LoadPeople(options.World);

        // Validate the paired events file automatically when it exists, since
        // cross-collection checks are the ones most likely to catch a real mistake.
        var eventsPath = options.Events ?? WorldJson.EventsPathFor(options.World);
        WorldEventsFile? events = null;
        if (File.Exists(eventsPath))
        {
            events = WorldJson.LoadEvents(eventsPath);
        }
        else if (options.Events is not null)
        {
            return Fail($"Events file not found: {options.Events}");
        }

        var findings = WorldValidator.Validate(world, events);
        var errors = findings.Count(finding => finding.Severity == Severity.Error);
        var warnings = findings.Count - errors;

        Console.WriteLine($"Validated {world.People.Count} people"
            + (events is null ? string.Empty : $" and {events.Events.Count} events")
            + $" in {options.World}.");

        if (findings.Count == 0)
        {
            Console.WriteLine("No problems found.");
            return 0;
        }

        Console.WriteLine();
        foreach (var finding in findings.OrderBy(f => f.Severity).ThenBy(f => f.Code))
        {
            Console.WriteLine($"  {finding}");
        }

        Console.WriteLine();
        Console.WriteLine($"{errors} error(s), {warnings} warning(s).");

        // --strict makes warnings fail too, for use in a pre-commit hook.
        return errors > 0 || (options.Strict && warnings > 0) ? 1 : 0;
    }

    // ── import ───────────────────────────────────────────────────────────────

    private static int RunImport(Options options)
    {
        if (options.Csv is null || options.World is null)
        {
            return Fail("import requires --csv <people.csv> and --world <path to {world}.json>.");
        }

        if (!File.Exists(options.Csv))
        {
            return Fail($"CSV not found: {options.Csv}");
        }

        var records = CsvParser.ParseRecords(File.ReadAllText(options.Csv));
        if (records.Count == 0)
        {
            return Fail("The CSV had a header but no data rows.");
        }

        var mapped = PersonCsvMapper.Map(records);
        foreach (var problem in mapped.Problems)
        {
            Console.WriteLine($"  csv: {problem}");
        }

        // --replace starts from an empty world; the default merges into what exists.
        var world = options.Replace || !File.Exists(options.World)
            ? new WorldPeopleFile()
            : WorldJson.LoadPeople(options.World);

        var merge = WorldMerger.Merge(world, mapped.People);
        foreach (var note in merge.Notes)
        {
            Console.WriteLine($"  merge: {note}");
        }

        Console.WriteLine($"Imported {mapped.People.Count} row(s): {merge.Added} added, {merge.Updated} updated.");

        // Always report on the merged result so an import cannot quietly
        // introduce a dangling reference.
        var findings = WorldValidator.Validate(world);
        var errors = findings.Count(finding => finding.Severity == Severity.Error);
        if (findings.Count > 0)
        {
            Console.WriteLine();
            foreach (var finding in findings.OrderBy(f => f.Severity).ThenBy(f => f.Code))
            {
                Console.WriteLine($"  {finding}");
            }
            Console.WriteLine();
        }

        if (options.DryRun)
        {
            Console.WriteLine($"--dry-run: {options.World} not written.");
            return errors > 0 ? 1 : 0;
        }

        if (errors > 0 && !options.Force)
        {
            Console.Error.WriteLine($"{errors} error(s) found; refusing to write. Re-run with --force to write anyway.");
            return 1;
        }

        WorldJson.SavePeople(options.World, world);
        Console.WriteLine($"Wrote {options.World} ({world.People.Count} people).");
        return 0;
    }

    // ── bulk-edit ────────────────────────────────────────────────────────────

    private static int RunBulkEdit(Options options)
    {
        if (options.World is null)
        {
            return Fail("bulk-edit requires --world <path to {world}.json>.");
        }

        if (options.Set.Count == 0)
        {
            return Fail("bulk-edit requires at least one --set field=value.");
        }

        var world = WorldJson.LoadPeople(options.World);
        var selector = new BulkEditSelector(
            House: options.Where.GetValueOrDefault("house"),
            Nation: options.Where.GetValueOrDefault("nation"),
            Tag: options.Where.GetValueOrDefault("tag"),
            Generation: options.Where.TryGetValue("generation", out var generationRaw)
                && int.TryParse(generationRaw, out var generation)
                    ? generation
                    : null,
            Visibility: options.Where.GetValueOrDefault("visibility"),
            Ids: options.Ids.Count > 0 ? options.Ids : null);

        // An unfiltered bulk edit would rewrite the whole world; make it deliberate.
        if (selector.IsEmpty && !options.All)
        {
            return Fail("bulk-edit with no --where filter would change everyone. "
                + "Pass --all to confirm, or add --where field=value.");
        }

        var result = BulkEditor.Apply(world, selector, options.Set);

        foreach (var problem in result.Problems)
        {
            Console.Error.WriteLine($"  {problem}");
        }

        if (result.Problems.Count > 0)
        {
            return 1;
        }

        Console.WriteLine($"Matched {result.Matched} person(s); {result.Changes.Count} field change(s).");
        foreach (var change in result.Changes)
        {
            Console.WriteLine($"  {change}");
        }

        if (result.Changes.Count == 0)
        {
            Console.WriteLine("Nothing to do.");
            return 0;
        }

        if (options.DryRun)
        {
            Console.WriteLine($"--dry-run: {options.World} not written.");
            return 0;
        }

        WorldJson.SavePeople(options.World, world);
        Console.WriteLine($"Wrote {options.World}.");
        return 0;
    }

    // ── Option plumbing ──────────────────────────────────────────────────────

    private sealed class Options
    {
        public string? World { get; set; }
        public string? Events { get; set; }
        public string? Csv { get; set; }
        public bool DryRun { get; set; }
        public bool Strict { get; set; }
        public bool Replace { get; set; }
        public bool Force { get; set; }
        public bool All { get; set; }
        public Dictionary<string, string> Where { get; } = new(StringComparer.OrdinalIgnoreCase);
        public Dictionary<string, string> Set { get; } = new(StringComparer.OrdinalIgnoreCase);
        public List<string> Ids { get; } = [];
    }

    private static Options ParseOptions(IEnumerable<string> args)
    {
        var options = new Options();
        var queue = new Queue<string>(args);

        while (queue.Count > 0)
        {
            var token = queue.Dequeue();
            switch (token)
            {
                case "--world":
                    options.World = Next(queue, token);
                    break;
                case "--events":
                    options.Events = Next(queue, token);
                    break;
                case "--csv":
                    options.Csv = Next(queue, token);
                    break;
                case "--dry-run":
                    options.DryRun = true;
                    break;
                case "--strict":
                    options.Strict = true;
                    break;
                case "--replace":
                    options.Replace = true;
                    break;
                case "--force":
                    options.Force = true;
                    break;
                case "--all":
                    options.All = true;
                    break;
                case "--id":
                    options.Ids.Add(Next(queue, token));
                    break;
                case "--where":
                    AddPair(options.Where, Next(queue, token), token);
                    break;
                case "--set":
                    AddPair(options.Set, Next(queue, token), token);
                    break;
                default:
                    throw new ArgumentException($"Unrecognised option '{token}'.");
            }
        }

        return options;
    }

    private static string Next(Queue<string> queue, string option) =>
        queue.Count > 0 ? queue.Dequeue() : throw new ArgumentException($"{option} needs a value.");

    private static void AddPair(Dictionary<string, string> target, string pair, string option)
    {
        var separator = pair.IndexOf('=');
        if (separator <= 0)
        {
            throw new ArgumentException($"{option} expects field=value, got '{pair}'.");
        }
        target[pair[..separator].Trim()] = pair[(separator + 1)..].Trim();
    }

    private static int Fail(string message)
    {
        Console.Error.WriteLine(message);
        Console.Error.WriteLine("Run with --help for usage.");
        return 2;
    }

    private static void PrintUsage()
    {
        // $$ raw string: single braces are literal (so "{world}.json" reads as
        // written), and {{ }} marks the actual interpolations.
        Console.WriteLine($$"""
            Dynasty Tools — import, validate, and bulk-edit dynasty world files.

            USAGE
              dynasty-tools <command> [options]

            COMMANDS
              validate   Check a world for structural problems.
              import     Read people from CSV into a world file.
              bulk-edit  Set fields across a filtered selection of people.

            VALIDATE
              dynasty-tools validate --world ../data/world.json [--events <path>] [--strict]

              The paired {world}-events.json is validated automatically when present.
              --strict also fails on warnings (useful in a pre-commit hook).

            IMPORT
              dynasty-tools import --csv people.csv --world ../data/world.json
                                   [--replace] [--dry-run] [--force]

              Merges on id: existing people are updated, new ids appended. An existing
              person's gmNotes are always preserved, since CSV cannot express them.
              --replace discards the current file instead of merging.
              Refuses to write if the result has validation errors unless --force.

              Columns (header row, any order, case-insensitive):
                {{string.Join(", ", PersonCsvMapper.KnownColumns)}}
              parentIds, spouseIds, and tags are '{{PersonCsvMapper.ListSeparator}}'-separated.
              Blank id cells get a generated p{n} id.

            BULK-EDIT
              dynasty-tools bulk-edit --world ../data/world.json
                                      --where house=Valcrest --set visibility=hidden
                                      [--id p1 --id p2] [--all] [--dry-run]

              --where accepts: house, nation, tag, generation, visibility
              --set accepts:   {{string.Join(", ", BulkEditor.SettableFields)}}
              Filters combine with AND. --all is required to edit everyone.

            EXIT CODES
              0 success   1 errors found / write refused   2 bad usage
            """);
    }
}
