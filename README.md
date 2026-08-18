# Dynasty Tracker

A GM tool for running the royal families and noble houses of a tabletop RPG
setting — deployed as a live site (Cloudflare Workers) you hand your players a
link to. It draws a growing family tree from JSON — no manual node-dragging —
and separates what you know as GM from what your players get to see.

```
silver-adventure/
├── data/                 # Seed / local-backup copies of world JSON. NOT the live store.
│   ├── world.json           # People — starts empty
│   └── world-events.json    # Events — starts empty
├── frontend/
│   ├── src/app/             # Angular 21 app (the tree, timeline, GM dossiers)
│   └── worker/               # Cloudflare Worker API (auth, R2 read/write, live WebSocket push)
└── tools/                # C# console tool (CSV import, validation, bulk edits) — local, git-file only
```

The live store is Cloudflare R2, behind the Worker's `/api/world/{world}` API — see
"Live architecture" below. `data/*.json` is a one-time seed and a local
backup/import target (see "Adding a whole new world" and "Editing: app or tool?"),
not something the deployed app reads or writes directly. `data/world.json` and
`data/world-events.json` start empty — `{ "people": [] }` and `{ "events": [] }`.
Add your own people and events through the app's `+ Person` / `+ Event` buttons
(GM View), or bulk-import a spreadsheet with the C# tool (see
[`tools/README.md`](tools/README.md)).

## Quick start

**The app** (needs Node 20.19+, 22.12+, or 24+):

```bash
cd frontend
npm install
npm start          # http://localhost:4200
```

`npm start` still mirrors `data/*.json` into `frontend/public/data/` first — a
leftover convenience for local reference and the C# tool, **not** something the
running app fetches anymore (see "Live architecture"). Run `npm test` for the
test suite.

**The tool** (needs the .NET 8 SDK):

```bash
cd tools
dotnet build
dotnet run --project src/DynastyTools -- validate --world ../data/world.json
```

## Live architecture

The deployed site is one Cloudflare Workers project (`frontend/wrangler.jsonc`,
project "age-of-aether-campaign") serving both the built Angular app (static
assets) and the API (`frontend/worker/`), same origin:

| Piece | What it does |
|---|---|
| **R2** (`age-of-aether-world-data` bucket) | Durable store — the actual `{ people: [...] }` / `{ events: [...] }` JSON, one object per world per dataset |
| **Worker** (`frontend/worker/index.ts`) | `GET /api/world/:world[/events]` (public read, GM-vs-player projected — see below), `POST /api/auth` (password → session token), `POST /api/world/:world[/events]` (authenticated write) |
| **Durable Object** (`WorldRoom`, `frontend/worker/world-room.ts`) | One per world. Relays a broadcast over WebSocket (`/api/world/:world/live`) to every open tab after a write — this is what makes a GM's save show up for players without a reload |

**GM auth:** `GM_PASSWORD` and `SESSION_SECRET` are Worker secrets
(`wrangler secret put`), never in this repo. Entering GM View prompts for the
password and exchanges it for a signed session token
(`frontend/worker/auth.ts`); the Worker independently re-verifies that token on
every write — the client-side gate is UX, not the security boundary.

**The Worker is also the trust boundary for reads, not just writes.** `GET
/api/world/:world[/events]` and the WebSocket broadcast both run the same
`toPlayerPeople`/`toPlayerEvents` projection the app uses for Player View —
server-side, before the response ever reaches the network — unless the request
carries a valid GM session token. Hidden people, `gmNotes`, and hidden events
never leave the Worker for an unauthenticated request; the client-side GM/Player
toggle is UX layered on top of that, not the thing actually keeping them out. A
GM's own tab sends its token on reads too, and on receiving a live push
re-fetches with that token rather than trusting the (player-filtered) pushed
payload — see `TreeDataService`/`TimelineDataService`'s `applyLivePush`.

**Local dev caveat:** `ng serve` only serves the Angular app, not `/api/*` — there's
no Worker running at `localhost:4200`. Backend changes need `wrangler deploy`
against the real Cloudflare project and testing there; on this repo's original dev
machine, `wrangler dev`/Miniflare couldn't run locally at all (the Workers runtime
refuses to start below macOS 13.5). Frontend-only UI work still runs fine under
`ng serve` — data loads will just fail against a non-existent local `/api/*` unless
you're testing against the deployed Worker some other way.

## The two view modes

One toggle in the header drives the whole app — tree, timeline, and dossier access
switch together, because they all read the same shared signal.

| | GM View | Player View |
|---|---|---|
| `visibility: "hidden"` people | Shown as a **redacted** card | Absent entirely |
| `hideParentage` people | Shown, with a dashed "rumoured" line to the parent | Shown, **no line upward** |
| `gmNotes` | Editable in the dossier panel | Not in the data, not in the DOM |
| Per-person controls | Visibility, parentage, edit, dossier | None rendered |

A fresh link lands in Player View by default — GM View requires the GM password
(see "Live architecture"). Player View is meant to be safe to put on a screen in
front of your players.
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

### Person — `{ people: Person[] }`, served at `/api/world/{world}`

All people live in **one flat pool per world**, across every nation and house.
Relationships are just id references, so a cross-house or cross-nation marriage is
an ordinary `spouseIds` link.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique within the world. `p1`, `p2`, … by convention, or whatever a CSV import assigns |
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

### DynastyEvent — `{ events: DynastyEvent[] }`, served at `/api/world/{world}/events`

Events are a separate collection, cross-linked to people by id rather than nested.

| Field | Type | Notes |
|---|---|---|
| `id` | string | `e1`, `e2`, … |
| `title` | string | |
| `type` | enum | `birth`, `death`, `coronation`, `wedding`, `war`, `battle`, `treaty`, `other` |
| `startYear` | number | Required. `startMonth` / `startDay` are optional precision on top |
| `endYear` | number? | Optional — a spanning event (a reign, a war). `endMonth` / `endDay` are optional precision on top |
| `era` | string? | Groups the timeline into labelled sections |
| `description` | string? | |
| `relatedPersonIds` | string[] | Every person the event involves, not just one |
| `nations` / `houses` | string[] | Which nation/house timelines the event appears on — manually curated, independent of `relatedPersonIds` (see "Filtering keeps the overlap") |
| `visibility` | `"known"` \| `"hidden"` | Same meaning as on Person |

## Filtering keeps the overlap

Filtering to a house or nation does **not** strictly exclude everyone else. People
matching the filter are *core*; anyone connected to them by marriage or parentage is
still drawn at 55% opacity and labelled "married in — not core house", as *adjacent*.

That is the whole point of one flat pool. Filter to one house and an in-married
spouse from another house still shows up, dimmed, rather than vanishing — a strict
filter would hide exactly the relationship a royal family chart exists to show.

**The nation/house chips are multi-select with union semantics** — click a chip to
jump to just that timeline (replacing the current selection, the fast path for
switching between a nation and a house); Ctrl/Cmd-click to add or remove it from the
current selection instead, combining several timelines into one view (e.g. "Nation
Asha" + "House Milltree" together shows anyone/anything in either). An event
qualifies for a timeline either automatically (it involves someone from there) or
because a GM explicitly tagged it into `nations`/`houses` — the tag pickers on the
event form let you pin an event onto a timeline it wouldn't otherwise reach.

## Navigating the tree

Click-and-drag anywhere on the tree to pan it (the cursor turns into a grab hand);
scroll the wheel to zoom in and out, anchored under the cursor, or use the +/−/Reset
control in the bottom-right corner. A click that doesn't move the cursor still
selects a card as before — only an actual drag is treated as panning.

## Entering dates

Every birth/death/event date field (person birth and death, event start and end)
opens the same popup calendar widget rather than raw number inputs — a trigger
button showing the current date, and a popup with month/year navigation and a day
grid. Day and month stay optional precision on top of year, matching the data
model: a year-only date is valid, and clearing the year clears the whole date.

## Adding a nation or house

Houses and nations are not configured anywhere — they are just strings on people, and
the filter chips are derived from whatever values exist. So:

1. **Add a person** with the new `house` / `nation` value (the `+ Person` button in
   GM View, or a row in a CSV import). The filter chips pick it up immediately.
2. **Link them in.** Give them a `spouseIds` or `parentIds` reference to someone who
   already exists, and the new house appears alongside the old one in the chart —
   dimmed when you filter to the other house, which is the behaviour you want.
3. **Set `generation`** to the parent's generation + 1. This decides the row; the
   validator warns when it disagrees with the parentage.
4. **Save.** The `Save` button POSTs both datasets to the live API — live for
   everyone with the link within moments, no git commit/push/redeploy involved.
   `Export backup` downloads a local copy for your own records; it is not itself
   a save (see "Live architecture" and "Editing: app or tool?").

### House colours

Each house gets an accent colour used on its card border, its dot, and its filter
chip, assigned deterministically by hashing the house name
(`frontend/src/app/models/house-colors.ts`). Nothing needs registering — invent a
house and it has a stable, on-palette colour immediately.

### Adding a whole new world

1. Create `data/{world}.json` with `{ "people": [] }` and
   `data/{world}-events.json` with `{ "events": [] }`.
2. Bulk-author the people in a spreadsheet and import them — see
   [`tools/README.md`](tools/README.md), and `tools/samples/people-template.csv`
   for the column layout.
3. **Seed R2**, since the deployed app never reads `data/` directly:
   ```bash
   cd frontend
   npx wrangler r2 object put age-of-aether-world-data/{world}.json --file=../data/{world}.json --content-type=application/json --remote
   npx wrangler r2 object put age-of-aether-world-data/{world}-events.json --file=../data/{world}-events.json --content-type=application/json --remote
   ```
4. Point the app at it by changing `DEFAULT_WORLD` in
   `frontend/src/app/services/tree-data.service.ts` (and `TimelineDataService`).

## Editing: app or tool?

The app and the tool no longer share one live file the way they used to — the app
reads and writes the live API (R2, via the Worker); the tool only ever reads and
writes `data/*.json` on disk. They can drift:

- **The app** is for shaping the tree live: adding people one at a time, wiring
  relationships with the search pickers, flipping visibility, writing dossiers —
  changes are visible to players as soon as you hit Save.
- **The tool** is for bulk work against the local files: importing a spreadsheet of
  thirty nobles, checking the world for broken references, or hiding an entire
  house in one command.
- **Reconciling the two directions:** after a tool run, re-seed R2 the same way
  "Adding a whole new world" does, so the bulk edit goes live. There's no automatic
  reverse sync — live edits made through the app are not written back to
  `data/*.json` — so treat `data/*.json` as an import staging area and occasional
  backup target (via `Export backup` in the app), not a mirror that's always current.
- **Known gap: the tool's event model is stale.** `tools/src/DynastyTools/Models/DynastyEvent.cs`
  still mirrors the *old* shape (`Year`, `Nation`, `House`) — the app's `DynastyEvent`
  moved to `startYear`/`endYear` and `nations`/`houses` arrays (see "Data model"
  above) and the tool hasn't been updated to match yet. Person import/validation is
  unaffected; treat event data as an app-only, hand-edited-via-the-app concern until
  the tool catches up.

In-progress app edits are mirrored to `localStorage`, so a refresh will not lose
work; `Revert` discards them and reloads from the live API. A `*` on the Save
button means there are unsaved changes.

## CI & security scanning

Every PR runs, via `.github/workflows/`:

| Check | What it covers |
|---|---|
| **CI** (`ci.yml`) | The frontend + Worker test suite (`npm test`, `npm run test:worker`) and the C# tool's tests (`dotnet test`) |
| **CodeQL** (`codeql.yml`) | Static analysis across the JS/TS (Angular + Worker) and C# code, plus a weekly scheduled run so newly-disclosed vulnerability patterns get checked against unchanged code |
| **Socket Security** | Supply-chain/dependency risk on every dependency change (already configured at the GitHub App level, not a workflow file here) |

`.github/dependabot.yml` opens PRs for outdated npm (`frontend/`), NuGet
(`tools/`), and GitHub Actions dependencies weekly, on top of the
security-only alerts GitHub already opens automatically.

**Local caveat:** this dev machine only has the .NET 6 SDK installed, so
`dotnet test` can't run locally here even though the project targets .NET 8 —
CI installs the right SDK itself (`actions/setup-dotnet@v4`). Not a project
issue, just this machine.

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
- **Visual language** is ported from the original reference React prototypes:
  parchment cards on a warm near-black ground, per-house border colours, antique gold
  for headings and marriage lines, deep red for GM View and dark green for Player
  View. Icons come from `lucide-angular`, the official Angular port of the
  prototypes' icon set.
- **Tests:** 71 in the app (`cd frontend && npm test`), 8 for the Worker
  (`cd frontend && npm run test:worker`), 68 in the tool (`cd tools && dotnet test`)
  — all against synthetic fixtures, none depend on the world data actually
  containing anyone.
