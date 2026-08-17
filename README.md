# Dynasty Tracker

A local, single-user tool for running the royal families and noble houses of a
tabletop RPG setting. It draws a growing family tree from plain JSON — no manual
node-dragging — and separates what you know as GM from what your players get to see.

```
silver-adventure/
├── data/                 # Canonical world files (JSON). The single source of truth.
│   ├── astyria.json          # People
│   └── astyria-events.json   # Events
├── frontend/             # Angular 21 app (the tree, timeline, GM dossiers)
└── tools/                # C# console tool (CSV import, validation, bulk edits)
```

## Quick start

**The app** (needs Node 20.19+, 22.12+, or 24+):

```bash
cd frontend
npm install
npm start          # http://localhost:4200
```

`npm start` mirrors `data/*.json` into `frontend/public/data/` first, so the app
always serves the canonical files. Run `npm test` for the test suite.

**The tool** (needs the .NET 8 SDK):

```bash
cd tools
dotnet build
dotnet run --project src/DynastyTools -- validate --world ../data/astyria.json
```

## The two view modes

One toggle in the header drives the whole app — tree, timeline, and dossier access
switch together, because they all read the same shared signal.

| | GM View | Player Preview |
|---|---|---|
| `visibility: "hidden"` people | Shown as a **redacted** card | Absent entirely |
| `hideParentage` people | Shown, with a dashed "rumoured" line to the parent | Shown, **no line upward** |
| `gmNotes` | Editable in the dossier panel | Not in the data, not in the DOM |
| Per-person controls | Visibility, parentage, edit, dossier | None rendered |

Player Preview is meant to be safe to put on a screen in front of your players.
It is not a CSS trick: the projection strips hidden records and `gmNotes` from the
data before rendering, the dossier component is never instantiated, and a suite of
tests asserts that no GM string reaches the player DOM.

Three subtleties the projection handles that are easy to get wrong:

- **Dangling ids leak.** A visible person married to a secret one would otherwise
  keep that secret id in `spouseIds`. Any id pointing at a hidden person is removed.
- **The concealment flag itself leaks.** `hideParentage` is cleared in the player
  projection — leaving it set would tell players exactly *whose* parentage is secret.
- **Events leak too.** A player-visible event drops hidden participants from
  `relatedPersonIds`. The validator additionally *warns* when a visible event
  involves a hidden person, because the event's own title may still name them.

## Data model

### Person — `data/{world}.json`

All people live in **one flat pool per world**, across every nation and house.
Relationships are just id references, so a cross-house or cross-nation marriage is
an ordinary `spouseIds` link.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique within the world. Sample data prefixes by nation: `a1…` Astyria, `v1…` Veyrenne |
| `name` | string | |
| `house` | string | |
| `nation` | string | |
| `title` | string? | `"King"`, `"Queen Consort"` |
| `birthYear` / `deathYear` | number? | |
| `isAlive` | boolean | |
| `parentIds` | string[] | 0–2 entries |
| `spouseIds` | string[] | Multiple marriages supported; kept symmetric automatically |
| `successionOrder` | number? | Orders siblings left-to-right within a generation |
| `notes` | string? | **Player-visible** |
| `tags` | string[]? | |
| `generation` | number | Which row of the tree. Parent + 1 |
| `visibility` | `"known"` \| `"hidden"` | Whether the person exists at all for players |
| `hideParentage` | boolean | Person is visible; their parents are not |
| `gmNotes` | GmNotes? | GM-only, always |

`gmNotes` holds `personalityTraits`, `physicalDescription`, `allies`, `enemies`,
`motivations`, `goals`, `ambitions`, and `secrets`. It is independent of the
visibility flags — even a fully `known` person's prep stays GM-only.

> `notes` is player-visible; `gmNotes.secrets` is not. Keep the distinction in mind.

### DynastyEvent — `data/{world}-events.json`

Events are a separate collection, cross-linked to people by id rather than nested.

| Field | Type | Notes |
|---|---|---|
| `id` | string | `e1`, `e2`, … |
| `title` | string | |
| `type` | enum | `birth`, `death`, `coronation`, `wedding`, `war`, `battle`, `treaty`, `other` |
| `year` | number | |
| `era` | string? | Groups the timeline into labelled sections |
| `description` | string? | |
| `relatedPersonIds` | string[] | |
| `nation` / `house` | string? | |
| `visibility` | `"known"` \| `"hidden"` | Same meaning as on Person |

## The sample world

`data/astyria.json` is the cast from the reference prototypes, across two nations:

- **Astyria** — House **Valcrest** (Aldric, Corin, Elara, Joran, Rowan, Tamsin), with
  **Solenne**, **Thornwood**, and **Ashgrove** connected by marriage.
- **Veyrenne** — House **Draven** (Baldric, Isolde, Thane) and **Marrow** (Selene).

It exercises every edge the model has: two marriages for one king (Corin), two
cross-nation in-marriages, a hidden person (**Joran Ash**, Aldric's unacknowledged
son), and a visible person with concealed parentage (**Tamsin Valcrest**).

> **Two reconciliations to be aware of.** The prototypes disagreed about Corin's
> marriage — `dynasty-tracker.jsx` had him married to Yseult Thornwood, while the
> overlap, dossier, and timeline prototypes all had Isolde Draven. This data treats
> them as two marriages in sequence: Yseult first (Tamsin's mother), then Isolde in
> 1224 (Rowan's mother). To make that coherent, three events were added that appear in
> no prototype: Corin's first wedding (1219), Tamsin's concealed birth (1221), and
> Yseult's death (1223). Change them freely if your canon differs.

## Filtering keeps the overlap

Filtering to a house or nation does **not** strictly exclude everyone else. People
matching the filter are *core*; anyone connected to them by marriage or parentage is
still drawn at 55% opacity and labelled "married in — not core house", as *adjacent*.

That is the whole point of one flat pool. Filter `astyria.json` to House Valcrest and
you get 6 Valcrests plus 5 connected outsiders — Mira Solenne and Yseult Thornwood who
married in, Isolde Draven from Veyrenne's own royal house, and the Ashgroves. A strict
filter would hide exactly the relationships a royal family chart exists to show —
Isolde's Draven identity is the thing that makes the Veyrenne treaty legible.

## Adding a nation or house

Houses and nations are not configured anywhere — they are just strings on people, and
the filter chips are derived from whatever values exist. So:

1. **Add a person** with the new `house` / `nation` value (the `+ Person` button in
   GM View, or a row in a CSV import). The dropdowns pick it up immediately.
2. **Link them in.** Give them a `spouseIds` or `parentIds` reference to someone who
   already exists, and the new house appears alongside the old one in the chart —
   dimmed when you filter to the other house, which is the behaviour you want.
3. **Set `generation`** to the parent's generation + 1. This decides the row; the
   validator warns when it disagrees with the parentage.
4. **Save.** The `Save` button writes `data/{world}.json` and
   `data/{world}-events.json`. Where a browser supports the File System Access API
   you can save straight over the originals; otherwise the files download and you
   move them into `data/` yourself.

### House colours

Each house gets an accent colour used on its card border, its dot, and its filter
chip. The six houses in the sample world use a hand-picked palette
(`frontend/src/app/models/house-colors.ts`); any house you invent later is hashed to a
stable colour from the same range, so nothing needs registering.

### Adding a whole new world

1. Create `data/{world}.json` with `{ "people": [] }` and
   `data/{world}-events.json` with `{ "events": [] }`.
2. Bulk-author the people in a spreadsheet and import them — see
   [`tools/README.md`](tools/README.md), and `tools/samples/people-template.csv`
   for the column layout.
3. Point the app at it by changing `DEFAULT_WORLD` in
   `frontend/src/app/services/tree-data.service.ts`.

## Editing: app or tool?

Both read and write the same files in the same format — byte-for-byte, so switching
between them produces no spurious diffs.

- **The app** is for shaping the tree: adding people one at a time, wiring
  relationships with the search pickers, flipping visibility, writing dossiers.
- **The tool** is for bulk work: importing a spreadsheet of thirty nobles, checking
  the world for broken references, or hiding an entire house in one command.

In-progress app edits are mirrored to `localStorage`, so a refresh will not lose
work; `Revert` discards them and reloads from disk. A `*` on the Save button means
there are unsaved changes.

## Notes on the build

- **Angular 21, not 22.** Angular 22 requires Node ≥ 22.22.3; 21 accepts Node
  20.19+/22.12+/24+ and has everything used here (signals, standalone components,
  reactive forms). Wider compatibility is worth more than the version number for a
  local tool.
- **A custom SVG tree renderer, not `family-chart`.** That package owns its own DOM
  and re-render cycle, which fights Angular's change detection, and it has no notion
  of the two things this data model needs most: multiple marriages per person, and
  dimmed *adjacent*-tier nodes. Layout geometry is a pure function in
  `frontend/src/app/models/tree-layout.ts`, unit-tested independently of rendering.
- **Visual language** is ported from the reference React prototypes: parchment cards
  on a warm near-black ground, per-house border colours, antique gold for headings and
  marriage lines, deep red for GM View and dark green for Player Preview. Icons come
  from `lucide-angular`, the official Angular port of the prototype's icon set.
- **Tests:** 50 in the app (`cd frontend && npm test`), 68 in the tool
  (`cd tools && dotnet test`).
