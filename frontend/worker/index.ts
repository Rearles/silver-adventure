import type { DynastyEvent } from '../src/app/models/dynasty-event';
import type { Person } from '../src/app/models/person';
import { toPlayerEvents, toPlayerPeople } from '../src/app/models/projection';
import type { WorldEventsFile, WorldPeopleFile } from '../src/app/models/world';
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

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), { status, headers: JSON_HEADERS });
}

/** True only for a request carrying a currently-valid GM session token. Never throws. */
async function isAuthenticated(request: Request, env: Env): Promise<boolean> {
  const header = request.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  return token !== '' && (await verifySessionToken(token, env));
}

async function readR2Json<T>(env: Env, key: string): Promise<T | null> {
  const object = await env.WORLD_BUCKET.get(key);
  if (object === null) return null;
  try {
    return JSON.parse(await object.text()) as T;
  } catch {
    return null;
  }
}

/**
 * GET /api/world/:world — public, but only ever returns the raw GM data (hidden
 * people, gmNotes included) to a request carrying a valid GM session token.
 * Everyone else gets the same `toPlayerPeople` projection the app applies
 * client-side for Player View — the Worker is the actual trust boundary; the
 * client-side view toggle is UX on top of it, not the enforcement point.
 */
async function readPeople(request: Request, env: Env, world: string): Promise<Response> {
  const people = (await readR2Json<WorldPeopleFile>(env, peopleKey(world)))?.people ?? [];
  if (await isAuthenticated(request, env)) {
    return new Response(JSON.stringify({ people }), { status: 200, headers: JSON_HEADERS });
  }
  const projected: WorldPeopleFile = { people: toPlayerPeople(people) };
  return new Response(JSON.stringify(projected), { status: 200, headers: JSON_HEADERS });
}

/** GET /api/world/:world/events — same GM-vs-player split as readPeople, via toPlayerEvents. */
async function readEvents(request: Request, env: Env, world: string): Promise<Response> {
  const events = (await readR2Json<WorldEventsFile>(env, eventsKey(world)))?.events ?? [];
  if (await isAuthenticated(request, env)) {
    return new Response(JSON.stringify({ events }), { status: 200, headers: JSON_HEADERS });
  }
  // toPlayerEvents needs to know who's visible, to scrub relatedPersonIds —
  // the same reason TimelineDataService's player projection reads people too.
  const people = (await readR2Json<WorldPeopleFile>(env, peopleKey(world)))?.people ?? [];
  const projected: WorldEventsFile = { events: toPlayerEvents(events, people) };
  return new Response(JSON.stringify(projected), { status: 200, headers: JSON_HEADERS });
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
  await stub.broadcast(kind, await playerFilteredBroadcast(kind, parsed, env, world));

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: JSON_HEADERS });
}

/**
 * The DO only ever relays this — never the raw `text` just written — so an
 * open tab with no GM session (any player's) never receives hidden people or
 * gmNotes over the WebSocket either, the same trust boundary as the GET
 * routes above. A GM's own tab detects its own push and re-fetches the real
 * data with its session token instead of trusting the broadcast payload —
 * see `TreeDataService`/`TimelineDataService`'s `applyLivePush`.
 */
async function playerFilteredBroadcast(kind: WorldKind, parsed: unknown, env: Env, world: string): Promise<string> {
  if (kind === 'people') {
    const people = (parsed as WorldPeopleFile).people as Person[];
    return JSON.stringify({ people: toPlayerPeople(people) } satisfies WorldPeopleFile);
  }
  const events = (parsed as WorldEventsFile).events as DynastyEvent[];
  const people = (await readR2Json<WorldPeopleFile>(env, peopleKey(world)))?.people ?? [];
  return JSON.stringify({ events: toPlayerEvents(events, people) } satisfies WorldEventsFile);
}

/**
 * Worker entry point for the "age-of-aether-campaign" live API. Route bodies
 * are filled in across plan steps:
 *  - GET  /api/world/:world           — read people from R2 (public read, GM-vs-player projected) [done]
 *  - GET  /api/world/:world/events    — read events from R2 (public read, GM-vs-player projected) [done]
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
        if (request.method === 'GET') return readPeople(request, env, world);
        if (request.method === 'POST') return handleWriteWorld(request, env, world, 'people');
      }
      if (segments.length === 4 && segments[3] === 'events') {
        if (request.method === 'GET') return readEvents(request, env, world);
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
