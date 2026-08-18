import { Injectable, computed, signal } from '@angular/core';

const STORAGE_KEY = 'dynasty-tracker:session-token';

/**
 * Holds the GM's session token (see frontend/worker/auth.ts for how it's
 * issued) across the app and across reloads.
 *
 * Storing it client-side is a UX convenience only, not a security boundary —
 * anything read from here is re-verified by the Worker on every write, which
 * is the actual security boundary (see the plan's Notes: "Auth model"). This
 * service doesn't know or care whether the token it's holding still verifies;
 * a stale/expired one just gets a 401 back from the Worker, at which point
 * the caller clears it and re-prompts.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly _token = signal<string | null>(readStoredToken());

  readonly token = this._token.asReadonly();
  readonly isAuthenticated = computed<boolean>(() => this._token() !== null);

  setToken(token: string): void {
    this._token.set(token);
    try {
      localStorage.setItem(STORAGE_KEY, token);
    } catch {
      // A full or unavailable localStorage just means the token won't
      // survive a reload — the GM re-enters the password, no worse off.
    }
  }

  clear(): void {
    this._token.set(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore.
    }
  }
}

function readStoredToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
