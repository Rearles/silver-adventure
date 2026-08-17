# Dynasty Tracker — frontend

Angular 21 app for the dynasty tree, timeline, and GM dossiers. See the
[root README](../README.md) for the data model and the GM/Player rules.

```bash
npm install
npm start      # http://localhost:4200
npm test       # 50 tests
npm run build  # production build into dist/
```

`npm start` and `npm run build` run `scripts/sync-data.mjs` first, which mirrors the
canonical `../data/*.json` into `public/data/`. Angular refuses to treat a directory
outside its workspace root as an asset input, so the app serves a generated copy.
**`public/data/` is git-ignored — never edit it directly**; edit `../data/` (or use the
C# tool) and the next start picks it up.

## Layout

```
src/app/
├── models/
│   ├── person.ts            # Person, GmNotes, PlayerPerson, PersonLike
│   ├── dynasty-event.ts
│   ├── world.ts             # File shapes, filter, year range
│   ├── house-colors.ts      # Per-house accent colours             (pure)
│   ├── projection.ts        # Player projections + overlap filter  (pure)
│   └── tree-layout.ts       # Tree geometry                        (pure)
├── services/
│   ├── view-mode.service.ts      # THE shared switchboard: mode, filter, selection
│   ├── tree-data.service.ts      # People: load/save, CRUD, projections
│   ├── timeline-data.service.ts  # Events: load/save, CRUD, projections
│   └── file-export.ts            # Save-to-disk / download
└── components/
    ├── person-card/     ├── filter-bar/    ├── tree-view/
    ├── person-form/     ├── gm-dossier/    └── timeline-view/
```

## Two things to know before changing this

**Everything reads its mode from `ViewModeService`.** The tree, the timeline, and
dossier access are driven by one shared signal — there is deliberately no second
toggle to keep in sync. Cross-component links go through it too: clicking an event
publishes related person ids for the tree to highlight, and selecting a person in the
tree filters the timeline. `TimelineView` holds no reference to `TreeView`.

**The type system enforces the player/GM boundary.** `PlayerPerson` is
`Omit<Person, 'gmNotes'>`, and rendering surfaces take `PersonLike`, which has no
`gmNotes` member at all — so a template cannot read GM prep even by accident. The
dossier goes through an explicit `TreeDataService.gmNotesFor()` accessor and is
rendered behind `@if (isGmView())`, which keeps it out of the component tree entirely
in Player Preview rather than merely hiding it.

`src/app/app.spec.ts` asserts both halves of that at the DOM level. If you add a
player-facing surface, add a case there.

## Styling

Palette tokens live in `src/styles.scss`; the redaction hatch shared by person cards
and timeline markers is a mixin in `src/styles/_shared.scss` (component SCSS compiles
in isolation, so it cannot reach a mixin defined in the global sheet). Icons come from
`lucide-angular` — pass the imported icon object straight to `[img]`, no `pick()`
registration needed.

## Pure logic lives in `models/`

`projection.ts` and `tree-layout.ts` have no Angular imports, which is why the
security-critical and geometry-critical code is unit-tested directly rather than
through the DOM. Prefer extending those over adding logic to a component.
