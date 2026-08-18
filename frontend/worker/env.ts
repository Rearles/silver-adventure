import type { WorldRoom } from './world-room';

/**
 * Cloudflare bindings available to the Worker (index.ts) and the WorldRoom
 * Durable Object (world-room.ts). Populated via frontend/wrangler.jsonc
 * (WORLD_BUCKET, WORLD_ROOM) and `wrangler secret put` (GM_PASSWORD,
 * SESSION_SECRET — never committed, never present in client-shipped code).
 */
export interface Env {
  WORLD_BUCKET: R2Bucket;
  WORLD_ROOM: DurableObjectNamespace<WorldRoom>;
  GM_PASSWORD: string;
  SESSION_SECRET: string;
}
