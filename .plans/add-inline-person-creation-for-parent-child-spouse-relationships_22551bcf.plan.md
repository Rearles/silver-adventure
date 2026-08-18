---
title: "Add a child picker to the person form and let all relationship pickers create a new person inline"
type: "feature"
created: "2026-08-17"
status: not-started
related: ["add-cloudflare-worker-live-persistence-and-gm-auth_aaa6a5ac.plan.md"]
---

# Add inline person creation for parent/child/spouse relationships

## Context

`Person` (frontend/src/app/models/person.ts) has `parentIds` and `spouseIds` but no `childIds` — a person is someone's child purely because that someone's id is in the child's own `parentIds`. `PersonForm` (frontend/src/app/components/person-form/person-form.ts + .html) currently has parent and spouse pickers (chips + search + results via `TreeDataService.searchByName`) but no child picker, and none of the pickers offer to create a person that doesn't exist yet. This plan adds a child picker and adds a "create new person" option to all three pickers, wired so newly-created people are attached to the relationship being edited.

## Todos

- [ ] Add `childrenOf`, `addChildLink`, `removeChildLink` to `TreeDataService` in frontend/src/app/services/tree-data.service.ts
- [ ] Add child picker signals/computed/methods to `PersonForm` in person-form.ts — mirror the spouse picker
- [ ] Add tempId staging (`pendingQuickCreates` signal, `nameFor` override) to `PersonForm`
- [ ] Add `createParent`/`createChild`/`createSpouse` to `PersonForm` — stage a draft, call the matching addX
- [ ] GC staged drafts in `removeParent`/`removeSpouse`/`removeChild` when the id is a tempId
- [ ] Rewrite `onSubmit()` in person-form.ts — resolve temp ids, save, diff-link children
- [ ] Add a Children picker section to person-form.html — mirror the Spouses section
- [ ] Add a "Create new person" row to all 3 results lists in person-form.html
- [ ] Style the `.create-new` results row in person-form.scss
- [ ] Test `childrenOf`/`addChildLink`/`removeChildLink` in a new tree-data.service.spec.ts

## Notes

**Why no `childIds` field on `Person`:** children are derived, not stored, everywhere else in the codebase (tree-view rendering, `normalizePool`). Adding a stored `childIds` would create a second source of truth that has to stay in sync with `parentIds` across every other person. Keep deriving it via `childrenOf(id) = displayPeople().filter(p => p.parentIds.includes(id))`, matching the pool `searchByName` already reads.

**`addChildLink(childId, parentId)` / `removeChildLink(childId, parentId)`:** read the child via `personById` (full pool), push/pull `parentId` into/out of the child's `parentIds` via the existing `updatePerson`, capped at 2 entries and deduped (already enforced by `normalizePool` inside `commit`). These are the only new service-level mutation methods needed — quick-created people themselves are just created via the existing `addPerson`.

**Why quick-created people are staged, not created on click:** the parent/spouse pickers already stage picks in form signals and only touch `TreeDataService` on Save (Cancel discards everything). If "Create new person" created the row immediately, clicking Create then Cancel would leave an orphaned, relationship-less person behind. It also can't work uniformly anyway: when *adding* a brand-new person (not editing), that person has no real id until their own submit, so a same-breath quick-created relative can't be linked to a real id yet either. Staging with a temp id keeps one consistent flow for both the "add new" and "edit existing" cases.

**TempId scheme:** generate e.g. `` `tmp:${crypto.randomUUID()}` `` on create; store `{ name, house, nation, generation }` in a `pendingQuickCreates` signal (`Map<string, QuickCreateDraft>`) keyed by tempId. Chips already just hold raw ids and call `nameFor(id)`, so temp and real ids flow through the existing chip/add/remove code unchanged as long as `nameFor` checks `pendingQuickCreates` first, then falls back to `treeData.nameFor(id)`.

**Quick-create defaults:** house/nation inherited from the current form's own `house`/`nation` controls (editable later on the new person). Generation: parent → `form.controls.generation.value - 1`, child → `+1`, spouse → same generation. `isAlive: true`, `visibility: 'known'`, `hideParentage: false`, empty `parentIds`/`spouseIds` — matches `resetForNew()`'s defaults.

**`onSubmit()` resolution order:** (1) materialize every `pendingQuickCreates` entry via `treeData.addPerson(...)`, building a tempId→realId map; (2) resolve that map through `parentIds()`/`spouseIds()`/`childIds()`; (3) save the person being edited (create or update) as today, getting `savedId`; (4) diff `initialChildIds` (captured when the form loaded — `[]` for a new person, `treeData.childrenOf(id)` when editing) against the resolved final child list: call `addChildLink(childId, savedId)` for additions, `removeChildLink(childId, savedId)` for removals.

**Child picker candidate filter:** exclude candidates already at the 2-parent cap (mirrors `parentsFull()`'s cap logic, but applied to the *candidate*, not the person being edited) — otherwise adding them as a child would silently evict one of their existing parents. No cap on how many children a person can have.

**"Create new person" row:** change the existing `@if (xSearch() !== '' && xResults().length > 0)` guards to `@if (xSearch().trim() !== '')` so the results block — and the create-new row inside it — renders even with zero name matches; that's the "minimum that should pop up" the feature is asking for.

**Section order in person-form.html:** Parents → Children → Spouses (up, down, across) — insert the new Children block between the existing Parents and Spouses blocks.

**Docstring:** update the `PersonForm` class comment in person-form.ts (currently: "Spouse reciprocity is not handled here...") to also cover children and the quick-create tempId flow.

**Testing:** no `person-form.spec.ts` or `tree-data.service.spec.ts` exists yet; other model specs use Vitest (`describe`/`expect`/`it` from `'vitest'`, see tree-layout.spec.ts). Cover the new service methods directly; component-level TestBed coverage of the full submit flow is out of scope for this plan.
