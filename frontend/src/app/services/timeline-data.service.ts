import { Injectable, computed, inject, signal } from '@angular/core';
import type { DynastyEvent } from '../models/dynasty-event';
import { toPlayerEvents } from '../models/projection';
import type { WorldEventsFile } from '../models/world';
import { SessionService } from './session.service';
import { DEFAULT_WORLD, TreeDataService } from './tree-data.service';
import { ViewModeService } from './view-mode.service';

/**
 * Loads, edits, and saves one world's events, mirroring `TreeDataService` —
 * including its live-API loading and its GM-vs-player trust boundary at the
 * Worker (see that class for the fuller rationale).
 *
 * Opens its own WebSocket to the same `/api/world/{world}/live` endpoint
 * `TreeDataService` does (one WorldRoom per world relays both kinds over
 * whatever sockets are connected to it, not one socket per dataset) and
 * ignores any push whose `kind` isn't `'events'`.
 *
 * Events reference people by id, so the same GM/player filtering pattern
 * applies: hidden events drop out of the player projection, and a surviving
 * event's `relatedPersonIds` is narrowed to people who survive too.
 */
@Injectable({ providedIn: 'root' })
export class TimelineDataService {
  private readonly viewMode = inject(ViewModeService);
  private readonly treeData = inject(TreeDataService);
  private readonly session = inject(SessionService);

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
   * The nation/house test mirrors the tree's overlap rule (union match — see
   * `WorldFilter`): an event counts if *any* of its own `nations`/`houses` tags
   * is in the selected sets *or* if it involves anyone in the filtered people
   * set, so a cross-house wedding stays on the timeline for both houses.
   * Range/sort anchor on `startYear` only — `endYear` (when present) doesn't
   * currently widen the range match.
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
        if (from !== null && event.startYear < from) return false;
        if (to !== null && event.startYear > to) return false;

        if (selectedPersonId !== null && !event.relatedPersonIds.includes(selectedPersonId)) {
          return false;
        }

        if (filter.nations.length === 0 && filter.houses.length === 0) return true;

        const ownMatch =
          event.nations.some((nation) => filter.nations.includes(nation)) ||
          event.houses.some((house) => filter.houses.includes(house));
        if (ownMatch) return true;

        return event.relatedPersonIds.some((id) => peopleInScope.has(id));
      })
      .sort((a, b) => a.startYear - b.startYear || a.title.localeCompare(b.title));
  });

  /** Year bounds across the events currently in view, for the range slider. */
  readonly yearBounds = computed<{ min: number; max: number } | null>(() => {
    const years = this.displayEvents().map((event) => event.startYear);
    if (years.length === 0) return null;
    return { min: Math.min(...years), max: Math.max(...years) };
  });

  private socket: WebSocket | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Loading & persistence ─────────────────────────────────────────────────

  async load(world: string = DEFAULT_WORLD, discardLocalEdits = false): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    this._world.set(world);

    const draft = discardLocalEdits ? null : this.readDraft(world);
    if (draft !== null) {
      this._events.set(draft);
      this._dirty.set(true);
      this._loading.set(false);
      this.connectLive(world);
      return;
    }

    try {
      const response = await fetch(`/api/world/${encodeURIComponent(world)}/events`, {
        cache: 'no-store',
        headers: this.authHeaders(),
      });
      if (!response.ok) {
        throw new Error(`/api/world/${world}/events responded ${response.status}`);
      }
      const parsed = (await response.json()) as WorldEventsFile;
      if (!Array.isArray(parsed.events)) {
        throw new Error(`/api/world/${world}/events has no "events" array`);
      }
      this._events.set(parsed.events);
      this._dirty.set(false);
      this.clearDraft(world);
    } catch (cause) {
      this._error.set(cause instanceof Error ? cause.message : String(cause));
    } finally {
      this._loading.set(false);
    }

    this.connectLive(world);
  }

  /** Sends the GM session token, when one is held, so the Worker returns the full GM data rather than the player projection. */
  private authHeaders(): HeadersInit {
    const token = this.session.token();
    return token === null ? {} : { Authorization: `Bearer ${token}` };
  }

  /** See TreeDataService.connectLive — same endpoint, same reconnect strategy, filtered to 'events' pushes. */
  private connectLive(world: string): void {
    if (typeof WebSocket === 'undefined') return;

    this.socket?.close();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    let socket: WebSocket;
    try {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${proto}://${location.host}/api/world/${encodeURIComponent(world)}/live`);
    } catch {
      return;
    }
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.reconnectAttempt = 0;
    });
    socket.addEventListener('message', (event) => {
      this.applyLivePush(String(event.data), world);
    });
    socket.addEventListener('close', () => {
      if (this.socket !== socket) return;
      this.scheduleReconnect(world);
    });
    socket.addEventListener('error', () => {
      socket.close();
    });
  }

  private scheduleReconnect(world: string): void {
    const delayMs = Math.min(30_000, 1_000 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => this.connectLive(world), delayMs);
  }

  /**
   * The pushed payload is always the player-filtered projection (see
   * frontend/worker/index.ts) — a GM tab re-fetches with its session token
   * instead of applying it directly, mirroring TreeDataService.applyLivePush.
   */
  private applyLivePush(raw: string, world: string): void {
    if (this.session.isAuthenticated()) {
      void this.refetchAuthenticated(world);
      return;
    }
    try {
      const message = JSON.parse(raw) as { kind?: string; payload?: string };
      if (message.kind !== 'events' || typeof message.payload !== 'string') return; // 'people' is TreeDataService's concern
      const parsed = JSON.parse(message.payload) as WorldEventsFile;
      if (!Array.isArray(parsed.events)) return;
      this._events.set(parsed.events);
      this._dirty.set(false);
    } catch {
      // A malformed push isn't worth surfacing as a hard error.
    }
  }

  /** GM-only refresh triggered by a live push: re-fetches the real (unfiltered) events with the held session token. */
  private async refetchAuthenticated(world: string): Promise<void> {
    try {
      const response = await fetch(`/api/world/${encodeURIComponent(world)}/events`, {
        cache: 'no-store',
        headers: this.authHeaders(),
      });
      if (!response.ok) return; // an expired token surfaces properly on the next explicit write instead
      const parsed = (await response.json()) as WorldEventsFile;
      if (!Array.isArray(parsed.events)) return;
      this._events.set(parsed.events);
      this._dirty.set(false);
    } catch {
      // Same philosophy as the parse failure above — not worth a hard error.
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
