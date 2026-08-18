import type { Env } from './env';
import { checkPassword, issueSessionToken, verifySessionToken } from './auth';
import { WorldRoom } from './world-room';

// wrangler's durable_objects binding resolves `class_name` against an export
// of this module (the file `main` in wrangler.jsonc points at) — re-export it
// here even though world-room.ts is where it's defined.
export { WorldRoom };

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

/** R2 object keys mirror the git filenames they replace, 1:1. */
function peopleKey(world: string): string {
  return `${world}.json`;
}
function eventsKey(world: string): string {
  return `${world}-events.json`;
}

/** Valid empty shape for a world that hasn't been seeded into R2 yet. */
const EMPTY_PEOPLE = JSON.stringify({ people: [] });
const EMPTY_EVENTS = JSON.stringify({ events: [] });

async function readBlob(env: Env, key: string, emptyFallback: string): Promise<Response> {
  const object = await env.WORLD_BUCKET.get(key);
  const body = object === null ? emptyFallback : await object.text();
  return new Response(body, { status: 200, headers: JSON_HEADERS });
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), { status, headers: JSON_HEADERS });
}

/** POST /api/auth — { password } in, { token } out. The real security boundary: */
async function handleAuth(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'invalid JSON body');
  }

  const password =
    typeof body === 'object' && body !== null && 'password' in body
      ? (body as { password: unknown }).password
      : undefined;

  if (typeof password !== 'string' || !(await checkPassword(password, env))) {
    return jsonError(401, 'invalid password');
  }

  const token = await issueSessionToken(env);
  return new Response(JSON.stringify({ token }), { status: 200, headers: JSON_HEADERS });
}

/** Requires a valid `Authorization: Bearer <token>` header. Returns an error Response to short-circuit with, or null if authorized. */
async function requireSession(request: Request, env: Env): Promise<Response | null> {
  const header = request.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (token === '' || !(await verifySessionToken(token, env))) {
    return jsonError(401, 'missing or invalid session token');
  }
  return null;
}

type WorldKind = 'people' | 'events';

/** Shallow shape check — just enough to catch a malformed body before it lands in R2. */
function hasArrayField(value: unknown, field: string): boolean {
  return typeof value === 'object' && value !== null && Array.isArray((value as Record<string, unknown>)[field]);
}

/** POST /api/world/:world (people) and POST /api/world/:world/events — authenticated write to R2 + DO notify. */
async function handleWriteWorld(request: Request, env: Env, world: string, kind: WorldKind): Promise<Response> {
  const unauthorized = await requireSession(request, env);
  if (unauthorized !== null) return unauthorized;

  const text = await request.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return jsonError(400, 'invalid JSON body');
  }
  const field = kind === 'people' ? 'people' : 'events';
  if (!hasArrayField(parsed, field)) {
    return jsonError(400, `expected { ${field}: [...] }`);
  }

  const key = kind === 'people' ? peopleKey(world) : eventsKey(world);
  await env.WORLD_BUCKET.put(key, text, { httpMetadata: { contentType: 'application/json' } });

  const stub = env.WORLD_ROOM.get(env.WORLD_ROOM.idFromName(world));
  await stub.broadcast(kind, text);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: JSON_HEADERS });
}

/**
 * Worker entry point for the "age-of-aether-campaign" live API. Route bodies
 * are filled in across plan steps:
 *  - GET  /api/world/:world           — read people from R2 (public)      [done]
 *  - GET  /api/world/:world/events    — read events from R2 (public)      [done]
 *  - POST /api/auth                   — check GM_PASSWORD, issue a session token [done]
 *  - POST /api/world/:world           — authenticated write to R2 + notify the DO [done]
 *  - POST /api/world/:world/events    — same, for events                         [done]
 *  - GET  /api/world/:world/live      — WebSocket upgrade, relayed via WorldRoom  [done]
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const segments = url.pathname.split('/').filter((segment) => segment !== '');

    if (request.method === 'POST' && segments.length === 2 && segments[0] === 'api' && segments[1] === 'auth') {
      return handleAuth(request, env);
    }

    if (segments[0] === 'api' && segments[1] === 'world' && segments[2] !== undefined) {
      const world = decodeURIComponent(segments[2]);

      if (segments.length === 3) {
        if (request.method === 'GET') return readBlob(env, peopleKey(world), EMPTY_PEOPLE);
        if (request.method === 'POST') return handleWriteWorld(request, env, world, 'people');
      }
      if (segments.length === 4 && segments[3] === 'events') {
        if (request.method === 'GET') return readBlob(env, eventsKey(world), EMPTY_EVENTS);
        if (request.method === 'POST') return handleWriteWorld(request, env, world, 'events');
      }
      // WebSocket upgrades can't go through DO RPC (broadcast()) — they need
      // a real fetch() to the stub, which is what returns the 101 response
      // carrying the client end of the socket pair back through the Worker.
      if (segments.length === 4 && segments[3] === 'live' && request.method === 'GET') {
        const stub = env.WORLD_ROOM.get(env.WORLD_ROOM.idFromName(world));
        return stub.fetch(request);
      }
    }

    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
