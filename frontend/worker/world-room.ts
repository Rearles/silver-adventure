import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';

/**
 * One instance per world (keyed by world name, see index.ts). Holds no
 * durable state of its own — R2 is the source of truth for world data. This
 * DO's only job is relaying live updates: accept WebSocket connections from
 * open player tabs and broadcast to them when the Worker's write route
 * reports a change (via broadcast(), called as an RPC from index.ts).
 *
 * Uses the Hibernation API (ctx.acceptWebSocket / ctx.getWebSockets()) rather
 * than manual in-memory socket bookkeeping in a field, so a table's worth of
 * idle-open tabs between sessions costs ~nothing — the DO can be evicted
 * from memory between messages without dropping the connection, and
 * getWebSockets() reflects the live set either way.
 */
export class WorldRoom extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** RPC target from the Worker's write route (index.ts) after a successful R2 write. */
  async broadcast(kind: 'people' | 'events', payload: string): Promise<void> {
    const message = JSON.stringify({ kind, payload });
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
      } catch {
        // A socket that can't send is already gone; nothing further to do —
        // getWebSockets() simply won't return it on the next broadcast.
      }
    }
  }

  // Hibernation API lifecycle hooks. This room is a broadcast-only relay —
  // clients never send anything meaningful, and there's no per-socket state
  // to clean up on close (getWebSockets() reflects the live set on its own)
  // — so both are intentionally inert, present only because the runtime
  // expects a handler once acceptWebSocket() is in use.
  async webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer): Promise<void> {}

  async webSocketClose(
    _ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {}
}
