---
title: "Rework event dates to Start/End and add multi-person, multi-nation/house timeline linking"
type: "feature"
created: "2026-08-18"
status: not-started
related: ["add-inline-person-creation-for-parent-child-spouse-relationships_22551bcf.plan.md", "add-drag-to-pan-and-zoom-to-the-family-tree_01750ef3.plan.md"]
---

# Rework event dates and multi-timeline linking

## Context

`DynastyEvent` (frontend/src/app/models/dynasty-event.ts) currently has one required `year: number` and single optional `nation?`/`house?` strings. `WorldFilter` (frontend/src/app/models/world.ts) is single-select and mutually exclusive today — `ViewModeService.setNation()` clears `house` and vice versa — so a nation timeline and a house timeline can never be viewed together, and an event belongs to at most one nation and one house, both implicitly. The live `events` array is currently empty (verified via `GET /api/world/world/events`), so no data migration is needed. The worker (frontend/worker/index.ts `hasArrayField`) only checks `Array.isArray(body.events)` — no per-event field validation — so no worker change is needed either.

This plan: (1) replaces `year` with a required `startYear`/optional `startMonth`/`startDay` and an optional `endYear`; (2) turns event `nation`/`house` into `nations: string[]`/`houses: string[]` so one event can be explicitly tagged into multiple nation and house timelines; (3) turns `WorldFilter` into multi-select arrays with **union** semantics (selecting Nation Asha + House Milltree shows anyone/event in *either*), which is what "combine timelines" means here; (4) adds a multi-person picker and an edit-event flow, since today only add/delete/toggle-visibility exist.

## Todos

- [ ] Update `DynastyEvent` (dynasty-event.ts): `year`→`startYear` (required) + `startMonth?`/`startDay?`, add `endYear?`; `nation?`/`house?` → `nations: string[]`/`houses: string[]`. Update `TimelineDataService` (its sole non-template consumer) — `filteredEvents` sort/range/own-match test and `yearBounds` — to match
- [ ] Update `WorldFilter`/`EMPTY_WORLD_FILTER` (world.ts) to `nations: string[]`/`houses: string[]`. Update `projection.ts`'s `matchesFilter`/`applyOverlapFilter` (its sole consumer) for union-of-selected-nations/houses matching, for both people and events
- [ ] Replace `setNation`/`setHouse` in `ViewModeService` with `toggleNation`/`toggleHouse`; update `FilterBar` ts/html to multi-select toggle chips (nations and houses each independently multi-selectable, not mutually exclusive)
- [ ] Update the Add-Event form in timeline-view.ts/html: Start (year required, month/day optional) + End (year optional) fields replacing the single Year field; update event display markup for the date range
- [ ] Add a multi-person picker to the event form for `relatedPersonIds` (checklist of people, pre-seeded with the tree-selected person if any)
- [ ] Add multi-select nation/house tag toggles to the event form for `nations`/`houses`, mirroring `FilterBar`'s chip pattern, so a GM can explicitly add/remove an event from a timeline independent of `relatedPersonIds` overlap
- [ ] Add an "Edit event" action (icon button in `.event-actions`) that pre-fills the form and calls `TimelineDataService.updateEvent` instead of `addEvent`
- [ ] Test: date validation (start required, end optional), multi-nation/house filter union behavior, multi-person event linking, and the edit-event flow

## Notes

**Why arrays with union semantics, not AND:** the request is explicit — "add and remove the events from the House of Milltree timeline to the Nation of Asha timeline" and "the ability to combine the timelines too." The old model made nation and house mutually exclusive single choices; the new one makes each independently multi-select, and a person/event matches if it's in *any* selected nation *or* any selected house (when either selection is non-empty). Intersection (AND) was considered and rejected — "combine" reads as "show these timelines together," i.e. union, not "show only the overlap."

**Why events get `nations`/`houses` arrays but `Person` keeps singular `nation`/`house`:** only events were asked to span multiple timelines ("link... to a single event", "add and remove... from the timeline"). A person still belongs to exactly one nation and one house. Don't touch `person.ts`.

**Manual tagging vs. automatic overlap:** `filteredEvents`' existing "own match OR any related person is in scope" rule is kept — an event automatically surfaces on a nation/house timeline if it directly involves someone from there. The new `nations`/`houses` arrays are the *manual* override layer on top: a GM can tag an event into a timeline it wouldn't otherwise qualify for (or leave both arrays empty and rely purely on the person-overlap rule). Removing a tag un-links it from that explicit timeline without touching `relatedPersonIds`.

**Why no data migration todo:** `GET /api/world/world/events` was checked directly against the live deployed Worker before writing this plan and returned `{"events": []}` — there is no live event data in the old shape to convert. If that changes before this plan runs, re-check before starting todo 1.

**End date has no month/day, by design:** the request specifically asked for month/day precision on the *start* only, and specifically said the end stays "not required" — read literally rather than assumed-symmetric with `Person`'s birth/death fields (which do carry month/day on both ends). If day/month precision on `endYear` is wanted later, it's an additive follow-up (see the "optional-field" technique this plan already uses elsewhere), not a reason to hold this plan.

**Applying the "land a cross-cutting field rename as independent green commits" lesson:** each todo above pairs a shared-type change with its *sole* consumer that would otherwise break the build (`TimelineDataService` for todo 1, `projection.ts` for todo 2, `FilterBar` for todo 3) rather than changing the type alone. That keeps every commit compiling and testing green, without needing a temporary backward-compat field — the full consumer set here is small enough (2–3 files per concern) that "type + its one real consumer" is itself already an atomic, reviewable unit.

**Testing:** no `timeline-data.service.spec.ts`, `projection.spec.ts` additions, or `filter-bar.spec.ts` exist yet for this area beyond what's in `app.spec.ts`/`projection.spec.ts`. Extend those rather than assuming full TestBed coverage of the new edit-event flow is required — follow the existing test-file layout (Vitest `describe`/`expect`/`it`, see `tree-layout.spec.ts` for the house style).

**Related work:** no file overlap with [[add-drag-to-pan-and-zoom-to-the-family-tree_01750ef3.plan.md]] (tree view only). [[add-inline-person-creation-for-parent-child-spouse-relationships_22551bcf.plan.md]] touches `PersonForm`/`TreeDataService` — unrelated files, but if the multi-person event picker in this plan's todo 5 wants a "create new person inline" affordance too, that's a follow-up extension of *that* plan's pattern, not something to duplicate here; this plan's picker only selects among existing people.
