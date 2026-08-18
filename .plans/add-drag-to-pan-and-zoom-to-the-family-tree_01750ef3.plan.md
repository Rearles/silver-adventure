---
title: "Add drag-to-pan and zoom controls to the family tree view"
type: "feature"
created: "2026-08-18"
status: complete
related: ["add-inline-person-creation-for-parent-child-spouse-relationships_22551bcf.plan.md", "rework-event-dates-and-multi-timeline-linking_5a23573c.plan.md"]
---

# Add drag-to-pan and zoom to the family tree

## Context

`TreeView` (frontend/src/app/components/tree-view/tree-view.ts + .html + .scss) renders the tree as absolutely-positioned `app-person-card`s over an SVG link layer, inside a `.tree-scroll` div that currently only supports native browser scrollbars (`overflow: auto`) — no click-and-drag panning, no zoom. Geometry comes from `layoutTree()` (frontend/src/app/models/tree-layout.ts), which this plan does not touch — pan/zoom is a pure view-layer concern layered on top via CSS transform + pointer/wheel events.

## Todos

- [x] Add `scale` signal + zoom clamp constants to `TreeView` (tree-view.ts)
- [x] Wrap `.tree-canvas` in a fixed-size `.tree-canvas-sizer` div in tree-view.html, sized to `layout().width/height * scale()`
- [x] Apply `transform: scale()` with `transform-origin: 0 0` to `.tree-canvas` in tree-view.scss
- [x] Add pointer-drag panning on `.tree-scroll` (pointerdown/move/up adjusting `scrollLeft`/`scrollTop`), suppressing `onSelect` when a drag exceeded a small movement threshold
- [x] Add wheel-to-zoom on `.tree-scroll`, adjusting `scale()` clamped to [min, max] and re-anchoring scroll position under the cursor
- [x] Add zoom in/out/reset buttons to the tree toolbar, wired to `scale()`
- [x] Update the highlighted-person `scrollTo` effect in tree-view.ts to account for `scale()` when computing target offsets
- [x] Test pan/zoom in a new `tree-view.spec.ts` — drag updates scroll position, wheel updates `scale()` within clamp bounds, click without drag still selects a card

## Notes

**Why native scroll + CSS transform, not a hand-rolled transform matrix or a library:** `.tree-scroll` already does panning "for free" via native scrollbars and the existing `scrollTo`-based centering effect. Keeping native scroll as the pan mechanism (drag just imperatively sets `scrollLeft`/`scrollTop`, the same numbers a scrollbar drag would produce) means zoom is the only new coordinate-math concern, not pan+zoom both. A `transform: scale()` on `.tree-canvas` needs a same-sized sizer wrapper because `transform` doesn't affect layout box size — without it the scrollable area wouldn't grow/shrink with zoom and content would clip or leave dead scroll space. No new dependency: the project's only non-Angular runtime dep is `lucide-angular`; a pan/zoom library is unjustified for CSS transform + pointer events this simple.

**Drag vs. click disambiguation:** `PersonCard`'s `select` output fires on a plain click today. A drag-pan gesture starts with the same `pointerdown` on the card's parent `.tree-scroll`; track total pointer movement between down and up, and swallow the subsequent click (or compare movement against a ~4px threshold before treating pointerup as a click) so dragging the canvas never also selects whatever card was under the cursor.

**Wheel zoom anchoring:** naive `scale` adjustment on wheel re-centers on the canvas origin, which feels wrong — zooming should keep the point under the cursor visually still. Compute the cursor's canvas-space coordinate before changing `scale`, then adjust `scrollLeft`/`scrollTop` after the resize so that same canvas point remains under the cursor.

**Scope:** Tree view only, per the request ("drag the family tree around... zoom in and zoom out on the family tree"). `TimelineView` is unaffected — it already scrolls natively as a normal list and was not asked for pan/zoom.

**Related work:** independent of [[add-inline-person-creation-for-parent-child-spouse-relationships_22551bcf.plan.md]] (person-form pickers) and [[rework-event-dates-and-multi-timeline-linking_5a23573c.plan.md]] (event/timeline data model) — no file overlap with either. Any order is fine.
