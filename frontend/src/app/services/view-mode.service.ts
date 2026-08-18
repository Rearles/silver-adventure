import { Injectable, computed, signal } from '@angular/core';
import type { DynastyEvent } from '../models/dynasty-event';
import {
  EMPTY_WORLD_FILTER,
  UNBOUNDED_YEARS,
  type WorldFilter,
  type YearRange,
} from '../models/world';

export type ViewMode = 'gm' | 'player';

/**
 * The one shared switchboard for view mode, filtering, and cross-component
 * selection.
 *
 * The tree, the timeline, and dossier access all read from here, so they can
 * never drift out of sync — there is deliberately no second toggle to keep in
 * step. It holds UI state only and injects no data services, which keeps it free
 * of cycles; callers hand it the little they need (an event's related person
 * ids, for instance) rather than it reaching into the stores.
 */
@Injectable({ providedIn: 'root' })
export class ViewModeService {
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
   * Switches view mode.
   *
   * Leaving GM View clears selection and highlights: they may point at people or
   * events that do not exist in the player projection, and carrying a stale
   * reference into Player Preview is exactly the kind of leak this app exists to
   * prevent.
   */
  setMode(mode: ViewMode): void {
    if (this._mode() === mode) return;
    this._mode.set(mode);
    if (mode === 'player') {
      this.clearSelection();
    }
  }

  toggleMode(): void {
    this.setMode(this._mode() === 'gm' ? 'player' : 'gm');
  }

  setFilter(filter: WorldFilter): void {
    this._filter.set(filter);
  }

  /** Changing nation clears house, since houses are scoped to a nation. */
  setNation(nation: string | null): void {
    this._filter.set({ nation, house: null });
  }

  setHouse(house: string | null): void {
    this._filter.update((current) => ({ ...current, house }));
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
