---
title: "Add lore documents (Houses/Nations + standalone topics) with [[wiki-link]] hover-preview cards"
type: "feature"
created: "2026-08-18"
status: in-progress
related: []
---

# Lore documents and hover-preview links

## Context

User wants a third data collection — `LoreDoc` — for long-form background articles (Houses/Nations as "organization" pages, plus standalone "topic" pages like wars/fires/famines), each a single markdown body, gated by the same `known`/`hidden` visibility model as `Person`/`DynastyEvent`. Any text field can contain `[[Wiki Link]]` tokens that resolve to a person or lore page and show a hover-preview card, matching the reference screenshot (House of Milltree popup). Mirrors the existing `people`/`events` architecture end-to-end: model → `world.ts` file shape → `projection.ts` player-filter → Worker route/R2/DO-broadcast → Angular service (load/save/live-socket/draft) → UI.

Confirmed decisions (already answered by user): Organization entity type for Houses/Nations + standalone topic pages; single markdown body per page; `[[Title]]` wiki-link syntax; lore pages carry `visibility: 'known' | 'hidden'` filtered server-side identically to `Person`/`DynastyEvent`. No `@angular/cdk` in this project — hover-preview positioning is hand-rolled via `getBoundingClientRect()`.

## Todos

- [x] Add `frontend/src/app/models/lore-doc.ts` — `LoreDoc`, `LoreDocType`, `LORE_DOC_TYPES`
- [x] Add `WorldLoreFile` to `frontend/src/app/models/world.ts`
- [x] Add `toPlayerLore()` to `frontend/src/app/models/projection.ts`
- [x] Extend `frontend/worker/world-room.ts` `broadcast()` kind to include `'lore'`
- [x] Extend `frontend/worker/index.ts` — `loreKey`, `readLore`, `WorldKind`, `handleWriteWorld`, `playerFilteredBroadcast`, `/api/world/:world/lore` route
- [x] Create `frontend/src/app/services/lore-data.service.ts` (mirrors `TreeDataService`/`TimelineDataService`)
- [x] Create `frontend/src/app/services/link-preview.service.ts` (hover show/hide timing + target/anchor signals)
- [x] Create `frontend/src/app/services/lore-ui.service.ts` (cross-component "open this lore doc" switchboard)
- [x] Create `frontend/src/app/components/wiki-text/` — parses `[[Title]]` tokens, renders hoverable/clickable links
- [x] Create `frontend/src/app/components/link-preview-card/` — global floating preview card, positioned via anchor rect
- [x] Create `frontend/src/app/components/lore-library/` — list (search/filter by org vs topic), article view, GM create/edit/delete/visibility-toggle form, all in a drawer/modal like `GmDossier`
- [ ] Wire `<app-link-preview-card>` and `<app-lore-library>` into `frontend/src/app/app.html`, add a header "Lore" toggle button in `frontend/src/app/app.ts`/`.html`, style the drawer/modal open state in `frontend/src/app/app.scss`
- [ ] Extend `frontend/src/app/app.ts` — inject `LoreDataService`, call `loreData.load()` in constructor, fold `loreData.dirty()` into the `dirty` computed, add a third `postWorld(.../lore, ...)` call to `onSaveWorld()`, a third `revert()` call to `onRevert()`, and a third `downloadTextFile()` call to `onExportBackup()`
- [ ] Wire `<app-wiki-text>` into existing read-only text displays: person notes (`frontend/src/app/components/gm-dossier/` or wherever `Person.notes` renders) and event description (`frontend/src/app/components/timeline-view/timeline-view.html`)
- [ ] Update root `README.md` with a short "Lore pages" section documenting `[[Wiki Link]]` syntax and where lore lives in the UI
- [ ] Test: add `toPlayerLore()` cases to `frontend/src/app/models/projection.spec.ts` (hidden doc dropped, cross-ref scrubbing for people/events/lore)
- [ ] Build/typecheck the frontend (`npm run build` or `ng build`) and fix any compile errors surfaced by the new files

## Notes

- Design precedent for every mirrored piece: `frontend/src/app/services/tree-data.service.ts` (service pattern), `frontend/worker/index.ts` + `frontend/worker/world-room.ts` (Worker/DO trio), `frontend/src/app/models/projection.ts` (player-filter pattern), `frontend/src/app/app.html`/`.ts` (GM-only overlay/drawer pattern used by `PersonForm`/`GmDossier`).
- `LinkPreviewService`/`LinkPreviewCard` use one shared global card (not one per `WikiText` instance) — hovering a link inside the card itself retargets the same card rather than stacking multiple popups. This is a deliberate simplification versus true Roam/Obsidian-style cascading stacked previews; acceptable for a first prototype.
- `WikiText` intentionally only implements paragraph breaks + `[[links]]`, no bold/italic/list markdown yet, to avoid needing `innerHTML`/`DomSanitizer`. Can be extended later without touching link-resolution logic.
- `LoreDataService.docByTitle()` is the wiki-link resolution key (case-insensitive exact match on `LoreDoc.title`); `TreeDataService.displayPeople()` name match is tried first, then lore title, then falls back to a `'missing'` target (still rendered as a link, per Obsidian/Roam convention for not-yet-created pages).
- Files already touched (uncommitted, on `claude/silver-adventure-refactored-tribble-mpjf1p`): see `git status` — `models/projection.ts`, `models/world.ts`, `worker/index.ts`, `worker/world-room.ts` modified; `models/lore-doc.ts`, `services/lore-data.service.ts`, `services/link-preview.service.ts`, `services/lore-ui.service.ts`, `components/wiki-text/`, `components/link-preview-card/` new. This work is currently on the repo's default branch — per team convention (see `create-pr` skill) it should move to a feature branch before opening a PR.
