import { describe, expect, it } from 'vitest';
import { checkPassword, issueSessionToken, verifySessionToken } from './auth';

/**
 * auth.ts uses only standard Web Crypto (no `cloudflare:workers` import), so
 * unlike index.ts/world-room.ts it runs directly in plain Node — no Workers
 * runtime/Miniflare needed. The rest of the Worker (routing, R2, the DO's
 * WebSocket relay) is verified by integration-testing the real deployed
 * Worker instead (see the plan's Notes for why: the Workers runtime binary
 * refuses to start on this repo's original dev machine).
 */

const env = { GM_PASSWORD: 'correct-horse-battery-staple', SESSION_SECRET: 'top-secret-signing-key' };

describe('checkPassword', () => {
  it('accepts the correct password', async () => {
    expect(await checkPassword('correct-horse-battery-staple', env)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    expect(await checkPassword('nope', env)).toBe(false);
  });

  it('rejects an empty password', async () => {
    expect(await checkPassword('', env)).toBe(false);
  });
});

describe('issueSessionToken / verifySessionToken', () => {
  it('issues a token in payload.signature form', async () => {
    const token = await issueSessionToken(env);
    expect(token).toMatch(/^[\w-]+\.[\w-]+$/);
  });

  it('verifies a token it just issued', async () => {
    const token = await issueSessionToken(env);
    expect(await verifySessionToken(token, env)).toBe(true);
  });

  it('rejects a tampered token', async () => {
    const token = await issueSessionToken(env);
    expect(await verifySessionToken(`${token}x`, env)).toBe(false);
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await issueSessionToken(env);
    expect(await verifySessionToken(token, { ...env, SESSION_SECRET: 'a-different-secret' })).toBe(false);
  });

  it('rejects garbage input', async () => {
    expect(await verifySessionToken('not-a-token', env)).toBe(false);
    expect(await verifySessionToken('', env)).toBe(false);
  });
});
