import type { Env } from './env';
import { WorldRoom } from './world-room';

// wrangler's durable_objects binding resolves `class_name` against an export
// of this module (the file `main` in wrangler.jsonc points at) — re-export it
// here even though world-room.ts is where it's defined.
export { WorldRoom };

/**
 * Worker entry point for the "age-of-aether-campaign" live API. Route bodies
 * are filled in by later plan steps:
 *  - GET  /api/world/:world        — read the current JSON from R2 (public)
 *  - POST /api/auth                — check GM_PASSWORD, issue a session token
 *  - POST /api/world/:world        — authenticated write to R2 + notify the DO
 *  - GET  /api/world/:world/live   — WebSocket upgrade, relayed via WorldRoom
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    void url;
    void env;
    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
