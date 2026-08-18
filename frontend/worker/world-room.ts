import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';

/**
 * One instance per world (keyed by world name, see index.ts). Holds no
 * durable state of its own — R2 is the source of truth for world data. This
 * DO's only job is relaying live updates: track connected WebSocket clients
 * and broadcast to them when the Worker's write route reports a change.
 *
 * WebSocket upgrade handling and broadcast-on-write are filled in by a later
 * plan step ("Implement WorldRoom DO — WebSocket upgrade handling + broadcast
 * on write notification").
 */
export class WorldRoom extends DurableObject<Env> {
  async fetch(_request: Request): Promise<Response> {
    return new Response('Not implemented', { status: 501 });
  }
}
