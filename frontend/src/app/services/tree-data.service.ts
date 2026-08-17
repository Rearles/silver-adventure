import { Injectable, computed, inject, signal } from '@angular/core';
import type { GmNotes, Person, PersonLike, PlayerPerson, Visibility } from '../models/person';
import { applyOverlapFilter, collectHouses, collectNations, toPlayerPeople } from '../models/projection';
import type { FilteredPerson } from '../models/projection';
import type { WorldPeopleFile } from '../models/world';
import { ViewModeService } from './view-mode.service';

export const DEFAULT_WORLD = 'world';

/**
 * Loads, edits, and saves one world's people, and derives the player-facing
 * projection.
 *
 * The canonical store is `data/{world}.json` at the repo root (served to the app
 * as `/data/...` — see the assets mapping in `angular.json`). The browser cannot
 * write back to that path on its own, so edits live in memory, are mirrored to
 * `localStorage` so a refresh does not lose work, and are written back to disk
 * either through the File System Access API or as a download you drop over the
 * original file.
 */
@Injectable({ providedIn: 'root' })
export class TreeDataService {
  private readonly viewMode = inject(ViewModeService);

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
  readonly houses = computed<string[]>(() =>
    collectHouses(this.displayPeople(), this.viewMode.filter().nation),
  );

  readonly count = computed<number>(() => this.displayPeople().length);
  readonly hiddenCount = computed<number>(
    () => this._people().filter((person) => person.visibility === 'hidden').length,
  );

  // ── Loading & persistence ─────────────────────────────────────────────────

  /**
   * Loads a world. A `localStorage` draft wins over the file on disk unless
   * `discardLocalEdits` is set, so an accidental refresh is not destructive.
   */
  async load(world: string = DEFAULT_WORLD, discardLocalEdits = false): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    this._world.set(world);

    try {
      if (!discardLocalEdits) {
        const draft = this.readDraft(world);
        if (draft !== null) {
          this._people.set(draft);
          this._dirty.set(true);
          return;
        }
      }

      const response = await fetch(`data/${world}.json`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`data/${world}.json responded ${response.status}`);
      }
      const parsed = (await response.json()) as WorldPeopleFile;
      if (!Array.isArray(parsed.people)) {
        throw new Error(`data/${world}.json has no "people" array`);
      }
      this._people.set(normalizePool(parsed.people));
      this._dirty.set(false);
      this.clearDraft(world);
    } catch (cause) {
      this._error.set(cause instanceof Error ? cause.message : String(cause));
    } finally {
      this._loading.set(false);
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
