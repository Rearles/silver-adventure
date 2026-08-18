import type { Env } from './env';
import { checkPassword, issueSessionToken } from './auth';
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

/**
 * Worker entry point for the "age-of-aether-campaign" live API. Route bodies
 * are filled in across plan steps:
 *  - GET  /api/world/:world           — read people from R2 (public)      [done]
 *  - GET  /api/world/:world/events    — read events from R2 (public)      [done]
 *  - POST /api/auth                   — check GM_PASSWORD, issue a session token [done]
 *  - POST /api/world/:world           — authenticated write to R2 + notify the DO
 *  - GET  /api/world/:world/live      — WebSocket upgrade, relayed via WorldRoom
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const segments = url.pathname.split('/').filter((segment) => segment !== '');

    if (request.method === 'POST' && segments.length === 2 && segments[0] === 'api' && segments[1] === 'auth') {
      return handleAuth(request, env);
    }

    if (
      request.method === 'GET' &&
      segments[0] === 'api' &&
      segments[1] === 'world' &&
      segments[2] !== undefined
    ) {
      const world = decodeURIComponent(segments[2]);

      if (segments.length === 3) {
        return readBlob(env, peopleKey(world), EMPTY_PEOPLE);
      }
      if (segments.length === 4 && segments[3] === 'events') {
        return readBlob(env, eventsKey(world), EMPTY_EVENTS);
      }
    }

    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
