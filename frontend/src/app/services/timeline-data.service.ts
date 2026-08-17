import { Injectable, computed, inject, signal } from '@angular/core';
import type { DynastyEvent } from '../models/dynasty-event';
import { toPlayerEvents } from '../models/projection';
import type { WorldEventsFile } from '../models/world';
import { DEFAULT_WORLD, TreeDataService } from './tree-data.service';
import { ViewModeService } from './view-mode.service';

/**
 * Loads, edits, and saves one world's events, mirroring `TreeDataService`.
 *
 * Events live in their own collection (`data/{world}-events.json`) and reference
 * people by id, so the same GM/player filtering pattern applies: hidden events
 * drop out of the player projection, and a surviving event's
 * `relatedPersonIds` is narrowed to people who survive too.
 */
@Injectable({ providedIn: 'root' })
export class TimelineDataService {
  private readonly viewMode = inject(ViewModeService);
  private readonly treeData = inject(TreeDataService);

  private readonly _events = signal<DynastyEvent[]>([]);
  private readonly _world = signal<string>(DEFAULT_WORLD);
  private readonly _loading = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);
  private readonly _dirty = signal<boolean>(false);

  readonly world = this._world.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly dirty = this._dirty.asReadonly();

  /** The GM's complete event list. */
  readonly gmEvents = this._events.asReadonly();

  /** Player projection: hidden events removed, related ids scrubbed. */
  readonly playerEvents = computed<DynastyEvent[]>(() =>
    toPlayerEvents(this._events(), this.treeData.gmPeople()),
  );

  readonly displayEvents = computed<DynastyEvent[]>(() =>
    this.viewMode.isGmView() ? this._events() : this.playerEvents(),
  );

  readonly hiddenCount = computed<number>(
    () => this._events().filter((event) => event.visibility === 'hidden').length,
  );

  /**
   * Events after the nation/house filter, the year range, and any person
   * selection made in the tree.
   *
   * The nation/house test mirrors the tree's overlap rule: an event counts if its
   * own nation/house matches *or* if it involves anyone in the filtered people
   * set, so a cross-house wedding stays on the timeline for both houses.
   */
  readonly filteredEvents = computed<DynastyEvent[]>(() => {
    const filter = this.viewMode.filter();
    const { from, to } = this.viewMode.yearRange();
    const selectedPersonId = this.viewMode.selectedPersonId();
    const peopleInScope = new Set(
      this.treeData.filteredPeople().map((entry) => entry.person.id),
    );

    return this.displayEvents()
      .filter((event) => {
        if (from !== null && event.year < from) return false;
        if (to !== null && event.year > to) return false;

        if (selectedPersonId !== null && !event.relatedPersonIds.includes(selectedPersonId)) {
          return false;
        }

        if (filter.nation === null && filter.house === null) return true;

        const ownMatch =
          (filter.nation === null || event.nation === filter.nation) &&
          (filter.house === null || event.house === filter.house);
        if (ownMatch) return true;

        return event.relatedPersonIds.some((id) => peopleInScope.has(id));
      })
      .sort((a, b) => a.year - b.year || a.title.localeCompare(b.title));
  });

  /** Year bounds across the events currently in view, for the range slider. */
  readonly yearBounds = computed<{ min: number; max: number } | null>(() => {
    const years = this.displayEvents().map((event) => event.year);
    if (years.length === 0) return null;
    return { min: Math.min(...years), max: Math.max(...years) };
  });

  // ── Loading & persistence ─────────────────────────────────────────────────

  async load(world: string = DEFAULT_WORLD, discardLocalEdits = false): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    this._world.set(world);

    try {
      if (!discardLocalEdits) {
        const draft = this.readDraft(world);
        if (draft !== null) {
          this._events.set(draft);
          this._dirty.set(true);
          return;
        }
      }

      const response = await fetch(`data/${world}-events.json`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`data/${world}-events.json responded ${response.status}`);
      }
      const parsed = (await response.json()) as WorldEventsFile;
      if (!Array.isArray(parsed.events)) {
        throw new Error(`data/${world}-events.json has no "events" array`);
      }
      this._events.set(parsed.events);
      this._dirty.set(false);
      this.clearDraft(world);
    } catch (cause) {
      this._error.set(cause instanceof Error ? cause.message : String(cause));
    } finally {
      this._loading.set(false);
    }
  }

  serialize(): string {
    const file: WorldEventsFile = { events: this._events() };
    return `${JSON.stringify(file, null, 2)}\n`;
  }

  fileName(): string {
    return `${this._world()}-events.json`;
  }

  private draftKey(world: string): string {
    return `dynasty-tracker:events:${world}`;
  }

  private readDraft(world: string): DynastyEvent[] | null {
    try {
      const raw = localStorage.getItem(this.draftKey(world));
      if (raw === null) return null;
      const parsed = JSON.parse(raw) as WorldEventsFile;
      return Array.isArray(parsed.events) ? parsed.events : null;
    } catch {
      return null;
    }
  }

  private writeDraft(): void {
    try {
      localStorage.setItem(this.draftKey(this._world()), this.serialize());
    } catch {
      // A full or unavailable localStorage must not break editing.
    }
  }

  private clearDraft(world: string): void {
    try {
      localStorage.removeItem(this.draftKey(world));
    } catch {
      // Ignore.
    }
  }

  async revert(): Promise<void> {
    this.clearDraft(this._world());
    await this.load(this._world(), true);
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  private commit(next: DynastyEvent[]): void {
    this._events.set(next);
    this._dirty.set(true);
    this.writeDraft();
  }

  eventById(id: string): DynastyEvent | undefined {
    return this._events().find((event) => event.id === id);
  }

  addEvent(draft: Omit<DynastyEvent, 'id'> & { id?: string }): DynastyEvent {
    const id = draft.id ?? this.nextId();
    const event: DynastyEvent = { ...draft, id };
    this.commit([...this._events(), event]);
    return event;
  }

  updateEvent(id: string, changes: Partial<Omit<DynastyEvent, 'id'>>): void {
    this.commit(
      this._events().map((event) => (event.id === id ? { ...event, ...changes, id } : event)),
    );
  }

  deleteEvent(id: string): void {
    this.commit(this._events().filter((event) => event.id !== id));
  }

  toggleVisibility(id: string): void {
    const event = this.eventById(id);
    if (event === undefined) return;
    this.updateEvent(id, {
      visibility: event.visibility === 'known' ? 'hidden' : 'known',
    });
  }

  /** Drops a deleted person's id from every event that referenced them. */
  forgetPerson(personId: string): void {
    this.commit(
      this._events().map((event) => ({
        ...event,
        relatedPersonIds: event.relatedPersonIds.filter((id) => id !== personId),
      })),
    );
  }

  private nextId(): string {
    let counter = this._events().length + 1;
    const taken = new Set(this._events().map((event) => event.id));
    while (taken.has(`e${counter}`)) counter += 1;
    return `e${counter}`;
  }
}
