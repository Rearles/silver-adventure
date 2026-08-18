---
title: "Add a Cloudflare Worker backend for live, real-time GM edits and real password-gated GM View"
type: "feature"
created: "2026-08-18"
status: in-progress
related: ["add-inline-person-creation-for-parent-child-spouse-relationships_22551bcf.plan.md"]
---

# Add Cloudflare Worker live persistence and GM auth

## Context

The deployed site (frontend/wrangler.jsonc, project "age-of-aether-campaign") is currently pure static assets — no backend, no bindings. `TreeDataService` (frontend/src/app/services/tree-data.service.ts) fetches `data/{world}.json` once at load and only ever writes to `localStorage` + a File-System-Access/download save (frontend/src/app/services/file-export.ts), requiring a manual commit/push/redeploy to reach players. This plan replaces that with a Worker backend: R2 holds the durable JSON, a Durable Object relays WebSocket broadcasts so open player tabs update live, and GM View is unlocked by a real server-checked password instead of a client-side toggle. The git-based `data/*.json` workflow is retired as the ongoing edit path (becomes a one-time seed source only).

## Todos

- [x] Create `frontend/worker/index.ts` (Worker entry) and `frontend/worker/world-room.ts` (Durable Object class)
- [x] Update `frontend/wrangler.jsonc` — add `main`, R2 bucket binding, DO binding + migrations block
- [x] Run `wrangler r2 bucket create` for the world-data bucket; record the name used — `age-of-aether-world-data`
- [x] Implement `GET /api/world/:world` in index.ts — reads the JSON blob from R2
- [x] Implement `POST /api/auth` in index.ts — checks `GM_PASSWORD` secret, issues signed session token
- [ ] Implement `POST /api/world/:world` in index.ts — verify token, write R2, notify the DO
- [ ] Implement `WorldRoom` DO — WebSocket upgrade handling + broadcast on write notification
- [ ] Set `GM_PASSWORD` and `SESSION_SECRET` via `wrangler secret put` (not committed to git)
- [ ] Update `TreeDataService.load()` — fetch from `/api/world/:world`, open WebSocket, apply pushes
- [ ] Update `onSaveWorld`/`onRevert` in app.ts to call the authenticated write API; retire file-export.ts's save path
- [ ] Gate the `gm` transition in `ViewModeService.setMode`/`toggleMode` behind a password prompt + valid session token
- [ ] Seed R2 from `data/world.json` and `data/world-events.json` via a one-time script or `wrangler r2 object put`
- [ ] Update README.md — document the live-API architecture; mark git data flow as seed-only
- [ ] Test Worker auth/read/write/broadcast logic (new `frontend/worker/*.spec.ts`, Miniflare-based)

## Notes

**Architecture split (why R2 + DO, not DO-only or R2-only):** R2 stays the durable source of truth, holding the exact `WorldPeopleFile`/events JSON shape the app already uses — minimal data-model change. The Durable Object (`WorldRoom`, one instance per world name) does *not* persist state itself; it only holds connected WebSocket clients in memory and relays a broadcast when the Worker tells it a write happened. On a GM write: Worker writes to R2 first (source of truth confirmed durable), then notifies the DO, then the DO pushes the new state to every open socket. This keeps "what's actually persisted" simple to reason about, inspect, and back up (a plain JSON blob in R2) separately from "who's currently listening" (ephemeral, in the DO).

**Confirmed free tier** (verified against https://developers.cloudflare.com/workers/platform/pricing/, not assumed): Workers 100,000 requests/day; Durable Objects 100,000 requests/day + 13,000 GB-s/day duration + 5M/100k SQLite reads/writes per day, **no paid plan required**; R2 10GB storage + 1M/10M Class A/B ops per month, zero egress fees. A tabletop campaign's traffic is far under every ceiling here.

**Auth model:** `GM_PASSWORD` is a Cloudflare Worker Secret (`wrangler secret put`), never present in any client-shipped code. `/api/auth` checks the submitted password and returns a session token signed with a second secret (`SESSION_SECRET`, e.g. HMAC-SHA256 over an expiry timestamp — no need for a full JWT library, a small hand-rolled signed-token helper is enough). The frontend stores that token (localStorage or a cookie) and sends it on write requests and the WebSocket upgrade. The same token gates the `ViewModeService` GM-View transition client-side *and* is independently re-checked by the Worker on every write — the client-side gate is just UX; the Worker check is the actual security boundary. There is deliberately no client-side-only password fallback path left in the code once this lands.

**What gets retired vs. kept:** `data/world.json` / `data/world-events.json` in git become a one-time seed/import source and a disaster-recovery reference (if R2 data is ever lost, the last-known-good git copy is the recovery path) — not an ongoing sync target. `file-export.ts`'s File-System-Access save/download flow is superseded by the authenticated write API; decide during implementation whether to delete it outright or keep `downloadTextFile` alone as a GM "export a local backup copy" convenience action off the live data. The `tools/` C# console app keeps operating on local `data/*.json` for CSV import/validation — it becomes a local prep/import tool feeding the one-time R2 seed step, not something rewired against the live API in this plan.

**Worker source location:** lives at `frontend/worker/`, alongside but separate from the Angular app (`frontend/src/app/`) and the Angular build (`frontend/dist/`) — `ng build` must not pick up or attempt to compile the Worker TypeScript, and `wrangler deploy`'s bundling must not need the Angular toolchain. Verify this boundary holds (e.g. `tsconfig.app.json`'s include/exclude) as part of the first two todos, not as an afterthought.

**Testing approach:** no existing Worker/backend test setup in this repo. Use Miniflare (via `wrangler`'s built-in local dev/test support, or `@cloudflare/vitest-pool-workers` since the frontend already uses Vitest) to exercise auth token issuance/verification, the R2 read/write round trip, and DO broadcast fan-out, without needing a real deployed Worker.

**Local runtime constraint discovered mid-implementation:** the actual Workers runtime binary (`workerd`, used by both `wrangler dev` and Miniflare/`@cloudflare/vitest-pool-workers`) refuses to start on this dev machine — macOS 12.6.0, below workerd's 13.5.0 minimum. `wrangler deploy --dry-run` still works (bundling/config validation only, no runtime needed) and is what's being used per-todo for verification instead. Todo 14 (the formal test step) will need a real decision: test against an actual deployed Worker instead of local Miniflare, get the dev machine's OS updated, or run the test suite somewhere else (CI). Revisit at that todo.

**Sequencing risk:** this migrates the durable source of truth off git entirely, which is a bigger blast radius than a typical feature. Treat "R2 has a verified good copy before the old save path is removed" and "the old save/download path is fully replaced, not left half-working" as hard gates — don't delete `file-export.ts`'s write path until the new authenticated write path is proven end-to-end against the deployed Worker.

**Related work:** [[add-inline-person-creation-for-parent-child-spouse-relationships_22551bcf.plan.md]] (child-picker/inline-create feature) is independent of this plan — it touches `PersonForm`/`TreeDataService` mutation methods but not the load/save transport this plan replaces. Either order is fine; if both are in flight, land this plan's `TreeDataService.load()`/write-path changes first, since the other plan's `onSubmit()` calls into `TreeDataService.addPerson`/`updatePerson`, whose *transport* (not their signatures) changes here.
