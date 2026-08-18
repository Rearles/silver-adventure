import { Injectable, computed, inject, signal } from '@angular/core';
import type { GmNotes, Person, PersonLike, PlayerPerson, Visibility } from '../models/person';
import { applyOverlapFilter, collectHouses, collectNations, toPlayerPeople } from '../models/projection';
import type { FilteredPerson } from '../models/projection';
import type { WorldPeopleFile } from '../models/world';
import { SessionService } from './session.service';
import { ViewModeService } from './view-mode.service';

export const DEFAULT_WORLD = 'world';

/**
 * Loads, edits, and saves one world's people, and derives the player-facing
 * projection.
 *
 * The canonical store is the Worker's `/api/world/{world}` endpoint (R2 behind
 * it — see frontend/worker/index.ts), not git. In-progress edits still live in
 * memory and are mirrored to `localStorage` so an accidental refresh before
 * Save doesn't lose work — that safety net is unchanged. What's new: after a
 * load, an `/api/world/{world}/live` WebSocket stays open and applies pushes
 * from the server (the GM's own saves, broadcast back) directly to `_people`,
 * so open tabs — including players' — update without a manual reload.
 *
 * The Worker itself is the trust boundary: it returns the full GM data only to
 * a request carrying a valid session token, and the same is true of what it
 * broadcasts over the live WebSocket (see frontend/worker/index.ts). A GM's
 * own tab sends its token on every GET and, on receiving a push, re-fetches
 * with that token rather than trusting the (player-filtered) pushed payload —
 * see `applyLivePush`.
 */
@Injectable({ providedIn: 'root' })
export class TreeDataService {
  private readonly viewMode = inject(ViewModeService);
  private readonly session = inject(SessionService);

  private readonly _people = signal<Person[]>([]);
  private readonly _world = signal<string>(DEFAULT_WORLD);
  private readonly _loading = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);
  private readonly _dirty = signal<boolean>(false);

  readonly world = this._world.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  /** True when in-memory edits have not been written back to a file. */
  readonly dirty = this._dirty.asReadonly();

  /** The GM's complete pool, `gmNotes` included. GM-only surfaces only. */
  readonly gmPeople = this._people.asReadonly();

  /** The player projection: hidden people gone, `gmNotes` structurally absent. */
  readonly playerPeople = computed<PlayerPerson[]>(() => toPlayerPeople(this._people()));

  /**
   * The pool to render in the current mode, typed as `PersonLike`.
   *
   * `PersonLike` has no `gmNotes` member, so a template bound to this cannot
   * reach GM prep regardless of mode. GM-only editing goes through
   * `personById` / `gmNotesFor` instead.
   */
  readonly displayPeople = computed<PersonLike[]>(() =>
    this.viewMode.isGmView() ? this._people() : this.playerPeople(),
  );

  /** The current pool after the overlap-preserving nation/house filter. */
  readonly filteredPeople = computed<FilteredPerson<PersonLike>[]>(() =>
    applyOverlapFilter(this.displayPeople(), this.viewMode.filter()),
  );

  readonly nations = computed<string[]>(() => collectNations(this.displayPeople()));
  /**
   * Scoped to the selected nation only when exactly one is selected —
   * `collectHouses` takes a single nation-or-null, so 0 or 2+ selected
   * nations both fall back to listing every house (unscoped).
   */
  readonly houses = computed<string[]>(() => {
    const selectedNations = this.viewMode.filter().nations;
    const nation = selectedNations.length === 1 ? selectedNations[0] : null;
    return collectHouses(this.displayPeople(), nation);
  });

  readonly count = computed<number>(() => this.displayPeople().length);
  readonly hiddenCount = computed<number>(
    () => this._people().filter((person) => person.visibility === 'hidden').length,
  );

  private socket: WebSocket | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Loading & persistence ─────────────────────────────────────────────────

  /**
   * Loads a world from the live API. A `localStorage` draft wins over the
   * server's copy unless `discardLocalEdits` is set, so an accidental refresh
   * mid-edit is not destructive — same safety net as before, just compared
   * against the live API's response instead of a static file. Either path
   * ends by (re)connecting the live-update WebSocket for this world.
   */
  async load(world: string = DEFAULT_WORLD, discardLocalEdits = false): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    this._world.set(world);

    const draft = discardLocalEdits ? null : this.readDraft(world);
    if (draft !== null) {
      this._people.set(draft);
      this._dirty.set(true);
      this._loading.set(false);
      this.connectLive(world);
      return;
    }

    try {
      const response = await fetch(`/api/world/${encodeURIComponent(world)}`, {
        cache: 'no-store',
        headers: this.authHeaders(),
      });
      if (!response.ok) {
        throw new Error(`/api/world/${world} responded ${response.status}`);
      }
      const parsed = (await response.json()) as WorldPeopleFile;
      if (!Array.isArray(parsed.people)) {
        throw new Error(`/api/world/${world} has no "people" array`);
      }
      this._people.set(normalizePool(parsed.people));
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

  /**
   * Opens (or re-opens) the live-update socket for `world`. Same-origin —
   * the Worker serves both the app and `/api/*`, so no CORS/proxy config is
   * needed in production. Reconnects on close with capped exponential
   * backoff, so a dropped wifi/sleeping laptop recovers on its own.
   */
  private connectLive(world: string): void {
    // Test environments (jsdom) don't implement WebSocket at all; a plain
    // static-file dev server for `ng serve` without the Worker running has
    // nothing at this path either. Either way, degrade to "no live updates"
    // rather than let a construction failure break the load() that already
    // succeeded.
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
      if (this.socket !== socket) return; // superseded by a newer connection
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
   * A push carries the *saved* state (this GM's own write, broadcast back) —
   * never treated as a local draft. The pushed payload itself is always the
   * player-filtered projection (see frontend/worker/index.ts) — a GM tab
   * doesn't apply it directly, since that would show its own hidden people
   * and gmNotes vanishing from its own GM View immediately after saving them.
   * It re-fetches with its session token instead, which is what actually
   * clears `_dirty` for a GM; a player tab applies the pushed payload as-is.
   */
  private applyLivePush(raw: string, world: string): void {
    if (this.session.isAuthenticated()) {
      void this.refetchAuthenticated(world);
      return;
    }
    try {
      const message = JSON.parse(raw) as { kind?: string; payload?: string };
      if (message.kind !== 'people' || typeof message.payload !== 'string') return; // 'events' is TimelineDataService's concern
      const parsed = JSON.parse(message.payload) as WorldPeopleFile;
      if (!Array.isArray(parsed.people)) return;
      this._people.set(normalizePool(parsed.people));
      this._dirty.set(false);
    } catch {
      // A malformed push isn't worth surfacing as a hard error — the next
      // successful push, or a manual reload, corrects the view.
    }
  }

  /** GM-only refresh triggered by a live push: re-fetches the real (unfiltered) data with the held session token. */
  private async refetchAuthenticated(world: string): Promise<void> {
    try {
      const response = await fetch(`/api/world/${encodeURIComponent(world)}`, {
        cache: 'no-store',
        headers: this.authHeaders(),
      });
      if (!response.ok) return; // an expired token surfaces properly on the next explicit write instead
      const parsed = (await response.json()) as WorldPeopleFile;
      if (!Array.isArray(parsed.people)) return;
      this._people.set(normalizePool(parsed.people));
      this._dirty.set(false);
    } catch {
      // Same philosophy as the parse failure above — not worth a hard error.
    }
  }

  /** Serialized `data/{world}.json` content, GM data included. */
  serialize(): string {
    const file: WorldPeopleFile = { people: this._people() };
    return `${JSON.stringify(file, null, 2)}\n`;
  }

  fileName(): string {
    return `${this._world()}.json`;
  }

  private draftKey(world: string): string {
    return `dynasty-tracker:people:${world}`;
  }

  private readDraft(world: string): Person[] | null {
    try {
      const raw = localStorage.getItem(this.draftKey(world));
      if (raw === null) return null;
      const parsed = JSON.parse(raw) as WorldPeopleFile;
      return Array.isArray(parsed.people) ? normalizePool(parsed.people) : null;
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

  /** Drops the local draft and reloads from the file on disk. */
  async revert(): Promise<void> {
    this.clearDraft(this._world());
    await this.load(this._world(), true);
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  private commit(next: Person[]): void {
    this._people.set(normalizePool(next));
    this._dirty.set(true);
    this.writeDraft();
  }

  personById(id: string): Person | undefined {
    return this._people().find((person) => person.id === id);
  }

  /** GM-only accessor for a person's prep notes. */
  gmNotesFor(id: string): GmNotes | undefined {
    return this.personById(id)?.gmNotes;
  }

  addPerson(draft: Omit<Person, 'id'> & { id?: string }): Person {
    const id = draft.id ?? this.nextId();
    const person: Person = { ...draft, id };
    this.commit([...this._people(), person]);
    return person;
  }

  updatePerson(id: string, changes: Partial<Omit<Person, 'id'>>): void {
    this.commit(
      this._people().map((person) =>
        person.id === id ? { ...person, ...changes, id } : person,
      ),
    );
  }

  /**
   * Removes a person and every reference to them, so no dangling parent or
   * spouse id survives the delete.
   */
  deletePerson(id: string): void {
    const remaining = this._people().filter((person) => person.id !== id);
    this.commit(
      remaining.map((person) => ({
        ...person,
        parentIds: person.parentIds.filter((parentId) => parentId !== id),
        spouseIds: person.spouseIds.filter((spouseId) => spouseId !== id),
      })),
    );
  }

  setVisibility(id: string, visibility: Visibility): void {
    this.updatePerson(id, { visibility });
  }

  toggleVisibility(id: string): void {
    const person = this.personById(id);
    if (person === undefined) return;
    this.setVisibility(id, person.visibility === 'known' ? 'hidden' : 'known');
  }

  setHideParentage(id: string, hideParentage: boolean): void {
    this.updatePerson(id, { hideParentage });
  }

  toggleHideParentage(id: string): void {
    const person = this.personById(id);
    if (person === undefined) return;
    this.setHideParentage(id, !person.hideParentage);
  }

  updateGmNotes(id: string, gmNotes: GmNotes): void {
    this.updatePerson(id, { gmNotes });
  }

  /** Case-insensitive name search, used by the parent/spouse pickers. */
  searchByName(term: string, excludeId?: string): PersonLike[] {
    const needle = term.trim().toLowerCase();
    const pool = this.displayPeople().filter((person) => person.id !== excludeId);
    if (needle === '') return pool.slice(0, 20);
    return pool
      .filter(
        (person) =>
          person.name.toLowerCase().includes(needle) ||
          person.house.toLowerCase().includes(needle),
      )
      .slice(0, 20);
  }

  nameFor(id: string): string {
    return this.displayPeople().find((person) => person.id === id)?.name ?? id;
  }

  private nextId(): string {
    let counter = this._people().length + 1;
    const taken = new Set(this._people().map((person) => person.id));
    while (taken.has(`p${counter}`)) counter += 1;
    return `p${counter}`;
  }
}

/**
 * Repairs the pool after any edit: spouse links are made symmetric, ids are
 * deduped, self-references dropped, and `parentIds` capped at two.
 *
 * Doing this centrally means the UI never has to remember to write both halves
 * of a marriage.
 */
export function normalizePool(people: readonly Person[]): Person[] {
  const ids = new Set(people.map((person) => person.id));
  const spouseSets = new Map<string, Set<string>>(
    people.map((person) => [person.id, new Set<string>()]),
  );

  for (const person of people) {
    for (const spouseId of person.spouseIds) {
      if (spouseId === person.id || !ids.has(spouseId)) continue;
      spouseSets.get(person.id)?.add(spouseId);
      spouseSets.get(spouseId)?.add(person.id);
    }
  }

  return people.map((person) => ({
    ...person,
    parentIds: [...new Set(person.parentIds)]
      .filter((parentId) => parentId !== person.id && ids.has(parentId))
      .slice(0, 2),
    spouseIds: [...(spouseSets.get(person.id) ?? new Set<string>())],
  }));
}
