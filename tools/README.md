# Dynasty Tools

A dependency-free .NET 8 console tool for bulk work on world files: importing people
from a spreadsheet, checking a world for structural problems, and setting fields
across many people at once.

It reads and writes exactly the format the Angular app uses — camelCase, two-space
indent, absent rather than null optional fields — so round-tripping a file through the
tool produces no diff noise.

```bash
cd tools
dotnet build
dotnet run --project src/DynastyTools -- --help
```

For convenience, publish a single binary and drop it on your PATH:

```bash
dotnet publish src/DynastyTools -c Release -o ./bin
./bin/DynastyTools validate --world ../data/astyria.json
```

Examples below use `dotnet run --project src/DynastyTools --` as the invocation.

## `validate`

```bash
dotnet run --project src/DynastyTools -- validate --world ../data/astyria.json [--strict]
```

Checks a world and reports findings by severity. The paired `{world}-events.json` is
picked up automatically when it exists, since the cross-collection checks catch the
most interesting mistakes.

**Errors** — the app cannot render these correctly:

| Code | Meaning |
|---|---|
| `duplicate-id` | Two people share an id |
| `missing-id` / `missing-name` | Required field absent |
| `dangling-parent` / `dangling-spouse` | Reference to a person who does not exist |
| `duplicate-parent` | Same parent listed twice |
| `self-parent` / `self-spouse` | A person related to themselves |
| `too-many-parents` | More than the two the model allows |
| `asymmetric-marriage` | A married B, but B did not marry A |
| `parentage-cycle` | Someone is their own ancestor |
| `death-before-birth` | |
| `bad-visibility` | Not `known` or `hidden` |
| `duplicate-event-id`, `missing-event-title`, `bad-event-type`, `bad-event-visibility`, `dangling-event-person` | Event equivalents |

**Warnings** — legal, but usually a typo. This is a fictional setting, so the tool
reports rather than refuses:

| Code | Meaning |
|---|---|
| `generation-gap` | `generation` disagrees with the parentage; the tree draws off-row |
| `child-before-parent` | Child born no later than a parent |
| `child-after-parent-death` | Child born more than a year after a parent died |
| `alive-with-death` / `dead-without-death` | `isAlive` disagrees with `deathYear` |
| `missing-house` / `missing-nation` | Filters will not find this person |
| `pointless-hideparentage` | Flag set on someone with no parents to hide |
| `known-event-hidden-person` | A player-visible event involves a hidden person — the projection scrubs the id, but check the title does not name them |

`--strict` makes warnings fail too, which is what you want in a pre-commit hook:

```bash
dotnet run --project src/DynastyTools -- validate --world ../data/astyria.json --strict
```

## `import`

```bash
dotnet run --project src/DynastyTools -- import --csv people.csv --world ../data/astyria.json
```

Merges CSV rows into an existing world, matching on `id`: known ids are updated, new
ones appended. Options: `--replace` to discard the current file instead of merging,
`--dry-run` to preview, `--force` to write despite validation errors.

**An existing person's `gmNotes` is always preserved.** CSV has no columns for GM prep,
so overwriting the whole record would silently destroy every dossier you had written.
The importer copies only the CSV-expressible fields and reports which dossiers it kept.

The import always validates the merged result and **refuses to write if there are
errors** unless you pass `--force`, so a spreadsheet typo cannot quietly introduce a
dangling reference.

### CSV format

Header row required; columns in any order, names case-insensitive. See
[`samples/people-template.csv`](samples/people-template.csv).

```
id,name,house,nation,title,birthYear,deathYear,isAlive,parentIds,spouseIds,
successionOrder,notes,tags,generation,visibility,hideParentage
```

- `parentIds`, `spouseIds`, `tags` are **semicolon**-separated (`k1;k2`) — the comma
  is already the field separator, so a GM should not have to quote every multi-parent cell.
- `isAlive` and `hideParentage` accept `true/false`, `yes/no`, `y/n`, `1/0`.
- Omit `isAlive` and it is inferred from whether a `deathYear` is present.
- A blank `id` gets a generated `p{n}` that will not collide with ids in the same import.
- Quoted fields may contain commas, doubled `""` for a literal quote, and newlines.
- Spouse links are made symmetric after import, so filling in only one side is fine.

Bad values are reported per line and the row still imports with that field unset,
rather than aborting the whole file.

## `bulk-edit`

```bash
dotnet run --project src/DynastyTools -- bulk-edit --world ../data/astyria.json \
  --where house=Valcrest --set visibility=hidden --dry-run
```

Selects people and assigns fields. `--where` filters combine with **AND**; repeat
`--id` to target specific people.

- `--where`: `house`, `nation`, `tag`, `generation`, `visibility`
- `--set`: `house`, `nation`, `title`, `visibility`, `hideParentage`, `isAlive`,
  `generation`, `successionOrder`, `addTag`, `removeTag`

Every run prints a per-person before → after list. `--dry-run` prints it without
writing. An unfiltered edit would rewrite the whole world, so it requires an explicit
`--all`.

```bash
# Hide a whole house ahead of a reveal
... bulk-edit --world ../data/astyria.json --where house=Ashfell --set visibility=hidden

# Tag a cadet branch
... bulk-edit --world ../data/astyria.json --where nation=Meruvia --set addTag=cadet-branch

# Fix two specific people
... bulk-edit --world ../data/astyria.json --id p11 --id p12 --set generation=2
```

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Validation errors found, or a write was refused |
| `2` | Bad usage |

## Layout

```
tools/
├── DynastyTools.sln
├── samples/people-template.csv
├── src/DynastyTools/
│   ├── Program.cs                     # CLI parsing and verb dispatch
│   ├── Models/                        # Person, GmNotes, DynastyEvent, world files
│   ├── Serialization/WorldJson.cs     # App-compatible JSON read/write
│   ├── Csv/                           # RFC 4180 parser + Person mapper
│   ├── Editing/                       # BulkEditor, WorldMerger
│   └── Validation/WorldValidator.cs   # All the rules above
└── tests/DynastyTools.Tests/          # 68 xunit tests — dotnet test
```

The logic classes take and return plain objects with no file or console access, which
is why they are directly unit-testable and why `--dry-run` is trivial to support.
