import { Injectable, computed, inject, signal } from '@angular/core';
import type { DynastyEvent } from '../models/dynasty-event';
import {
  EMPTY_WORLD_FILTER,
  UNBOUNDED_YEARS,
  type WorldFilter,
  type YearRange,
} from '../models/world';
import { SessionService } from './session.service';

export type ViewMode = 'gm' | 'player';

/**
 * The one shared switchboard for view mode, filtering, and cross-component
 * selection.
 *
 * The tree, the timeline, and dossier access all read from here, so they can
 * never drift out of sync — there is deliberately no second toggle to keep in
 * step. It injects only `SessionService` (a plain token holder, no data-fetch
 * dependencies of its own) — never the tree/timeline data stores — so there's
 * no cycle risk; callers still hand it the little they need (an event's
 * related person ids, for instance) rather than it reaching into the stores.
 */
@Injectable({ providedIn: 'root' })
export class ViewModeService {
  private readonly session = inject(SessionService);

  // Defaults to 'player': a freshly-opened link (the one handed to players)
  // must land read-only, with no edit affordances or GM dossier instantiated,
  // before anyone has touched the toggle. The GM flips to 'gm' explicitly
  // each session when prepping.
  private readonly _mode = signal<ViewMode>('player');
  /** Current view mode. Change it through `setMode` / `toggleMode`. */
  readonly mode = this._mode.asReadonly();
  readonly isGmView = computed(() => this._mode() === 'gm');
  readonly isPlayerPreview = computed(() => this._mode() === 'player');

  private readonly _filter = signal<WorldFilter>(EMPTY_WORLD_FILTER);
  readonly filter = this._filter.asReadonly();

  private readonly _yearRange = signal<YearRange>(UNBOUNDED_YEARS);
  readonly yearRange = this._yearRange.asReadonly();

  private readonly _selectedPersonId = signal<string | null>(null);
  /** Selecting a person narrows the timeline to that person's events. */
  readonly selectedPersonId = this._selectedPersonId.asReadonly();

  private readonly _selectedEventId = signal<string | null>(null);
  readonly selectedEventId = this._selectedEventId.asReadonly();

  private readonly _highlightedPersonIds = signal<ReadonlySet<string>>(new Set<string>());
  /** People the tree should highlight and scroll to, set by clicking an event. */
  readonly highlightedPersonIds = this._highlightedPersonIds.asReadonly();

  /**
   * Switches view mode. Entering GM View requires a valid session — if none
   * is held yet, this prompts for the GM password and calls `/api/auth`
   * before switching; a wrong password, a cancelled prompt, or a network
   * failure all leave the mode unchanged (stays in Player View). This is a
   * UX gate, not the real security boundary: the Worker independently
   * re-verifies the token on every write regardless (see auth.ts).
   *
   * Leaving GM View clears selection and highlights: they may point at people or
   * events that do not exist in the player projection, and carrying a stale
   * reference into Player Preview is exactly the kind of leak this app exists to
   * prevent.
   */
  async setMode(mode: ViewMode): Promise<void> {
    if (this._mode() === mode) return;

    if (mode === 'gm' && !this.session.isAuthenticated()) {
      const granted = await this.requestGmAccess();
      if (!granted) return;
    }

    this._mode.set(mode);
    if (mode === 'player') {
      this.clearSelection();
    }
  }

  /** Prompts for the GM password and exchanges it for a session token via /api/auth. */
  private async requestGmAccess(): Promise<boolean> {
    const password = globalThis.prompt('GM password:');
    if (password === null || password === '') return false;

    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) return false;

      const body = (await response.json()) as { token?: unknown };
      if (typeof body.token !== 'string') return false;

      this.session.setToken(body.token);
      return true;
    } catch {
      return false;
    }
  }

  async toggleMode(): Promise<void> {
    await this.setMode(this._mode() === 'gm' ? 'player' : 'gm');
  }

  setFilter(filter: WorldFilter): void {
    this._filter.set(filter);
  }

  // TODO(rework-event-dates plan, next step): these still replace the whole
  // selection (old single-select behaviour) rather than the planned
  // click-to-jump/Ctrl-click-to-combine split — that's the next step's real
  // work. Kept as single-element arrays for now so FilterBar keeps compiling
  // and behaving exactly as before against the new array-shaped WorldFilter.

  /** Changing nation clears house, since houses are scoped to a nation. */
  setNation(nation: string | null): void {
    this._filter.set({ nations: nation === null ? [] : [nation], houses: [] });
  }

  setHouse(house: string | null): void {
    this._filter.update((current) => ({
      ...current,
      houses: house === null ? [] : [house],
    }));
  }

  clearFilter(): void {
    this._filter.set(EMPTY_WORLD_FILTER);
  }

  setYearRange(range: YearRange): void {
    this._yearRange.set(range);
  }

  clearYearRange(): void {
    this._yearRange.set(UNBOUNDED_YEARS);
  }

  /** Tree → timeline: selecting a person filters the timeline to their events. */
  selectPerson(personId: string | null): void {
    this._selectedPersonId.set(personId);
    // A fresh person selection supersedes any event-driven highlight.
    this._selectedEventId.set(null);
    this._highlightedPersonIds.set(new Set<string>());
  }

  /** Timeline → tree: selecting an event highlights the people it involves. */
  selectEvent(event: Pick<DynastyEvent, 'id' | 'relatedPersonIds'> | null): void {
    if (event === null) {
      this._selectedEventId.set(null);
      this._highlightedPersonIds.set(new Set<string>());
      return;
    }
    this._selectedEventId.set(event.id);
    this._highlightedPersonIds.set(new Set(event.relatedPersonIds));
  }

  clearSelection(): void {
    this._selectedPersonId.set(null);
    this._selectedEventId.set(null);
    this._highlightedPersonIds.set(new Set<string>());
  }
}
