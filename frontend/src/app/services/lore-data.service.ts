import { Injectable, computed, inject, signal } from '@angular/core';
import type { LoreDoc } from '../models/lore-doc';
import type { Visibility } from '../models/person';
import { toPlayerLore } from '../models/projection';
import type { WorldLoreFile } from '../models/world';
import { SessionService } from './session.service';
import { TimelineDataService } from './timeline-data.service';
import { TreeDataService } from './tree-data.service';
import { ViewModeService } from './view-mode.service';

/**
 * Loads, edits, and saves one world's lore pages — the third collection
 * alongside `TreeDataService` (people) and `TimelineDataService` (events),
 * following the exact same load/save/live-socket/draft pattern. See
 * `TreeDataService`'s doc comment for the full rationale; this one only notes
 * what's different.
 *
 * Opens its own WebSocket to the same `/api/world/{world}/live` endpoint the
 * other two do (one `WorldRoom` per world relays all three kinds over
 * whatever sockets are connected to it) and ignores any push whose `kind`
 * isn't `'lore'`.
 */
@Injectable({ providedIn: 'root' })
export class LoreDataService {
  private readonly viewMode = inject(ViewModeService);
  private readonly session = inject(SessionService);
  private readonly treeData = inject(TreeDataService);
  private readonly timelineData = inject(TimelineDataService);

  private readonly _lore = signal<LoreDoc[]>([]);
  private readonly _world = signal<string>('world');
  private readonly _loading = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);
  private readonly _dirty = signal<boolean>(false);

  readonly world = this._world.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly dirty = this._dirty.asReadonly();

  /** The GM's complete pool, hidden pages included. */
  readonly gmLore = this._lore.asReadonly();

  /** The player projection: hidden pages gone, cross-references scrubbed. */
  readonly playerLore = computed<LoreDoc[]>(() =>
    toPlayerLore(this._lore(), this.treeData.gmPeople(), this.timelineData.gmEvents()),
  );

  readonly displayLore = computed<LoreDoc[]>(() =>
    this.viewMode.isGmView() ? this._lore() : this.playerLore(),
  );

  readonly hiddenCount = computed<number>(
    () => this._lore().filter((doc) => doc.visibility === 'hidden').length,
  );

  private socket: WebSocket | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  async load(world: string = 'world', discardLocalEdits = false): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    this._world.set(world);

    const draft = discardLocalEdits ? null : this.readDraft(world);
    if (draft !== null) {
      this._lore.set(draft);
      this._dirty.set(true);
      this._loading.set(false);
      this.connectLive(world);
      return;
    }

    try {
      const response = await fetch(`/api/world/${encodeURIComponent(world)}/lore`, {
        cache: 'no-store',
        headers: this.authHeaders(),
      });
      if (!response.ok) {
        throw new Error(`/api/world/${world}/lore responded ${response.status}`);
      }
      const parsed = (await response.json()) as WorldLoreFile;
      if (!Array.isArray(parsed.lore)) {
        throw new Error(`/api/world/${world}/lore has no "lore" array`);
      }
      this._lore.set(parsed.lore);
      this._dirty.set(false);
      this.clearDraft(world);
    } catch (cause) {
      this._error.set(cause instanceof Error ? cause.message : String(cause));
    } finally {
      this._loading.set(false);
    }

    this.connectLive(world);
  }

  private authHeaders(): HeadersInit {
    const token = this.session.token();
    return token === null ? {} : { Authorization: `Bearer ${token}` };
  }

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

  private applyLivePush(raw: string, world: string): void {
    if (this.session.isAuthenticated()) {
      void this.refetchAuthenticated(world);
      return;
    }
    try {
      const message = JSON.parse(raw) as { kind?: string; payload?: string };
      if (message.kind !== 'lore' || typeof message.payload !== 'string') return; // 'people'/'events' are the other services' concern
      const parsed = JSON.parse(message.payload) as WorldLoreFile;
      if (!Array.isArray(parsed.lore)) return;
      this._lore.set(parsed.lore);
      this._dirty.set(false);
    } catch {
      // Not worth a hard error — the next successful push, or a manual reload, corrects the view.
    }
  }

  private async refetchAuthenticated(world: string): Promise<void> {
    try {
      const response = await fetch(`/api/world/${encodeURIComponent(world)}/lore`, {
        cache: 'no-store',
        headers: this.authHeaders(),
      });
      if (!response.ok) return;
      const parsed = (await response.json()) as WorldLoreFile;
      if (!Array.isArray(parsed.lore)) return;
      this._lore.set(parsed.lore);
      this._dirty.set(false);
    } catch {
      // Same philosophy as the parse failure above.
    }
  }

  serialize(): string {
    const file: WorldLoreFile = { lore: this._lore() };
    return `${JSON.stringify(file, null, 2)}\n`;
  }

  fileName(): string {
    return `${this._world()}-lore.json`;
  }

  private draftKey(world: string): string {
    return `dynasty-tracker:lore:${world}`;
  }

  private readDraft(world: string): LoreDoc[] | null {
    try {
      const raw = localStorage.getItem(this.draftKey(world));
      if (raw === null) return null;
      const parsed = JSON.parse(raw) as WorldLoreFile;
      return Array.isArray(parsed.lore) ? parsed.lore : null;
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

  private commit(next: LoreDoc[]): void {
    this._lore.set(next);
    this._dirty.set(true);
    this.writeDraft();
  }

  docById(id: string): LoreDoc | undefined {
    return this._lore().find((doc) => doc.id === id);
  }

  addDoc(draft: Omit<LoreDoc, 'id'> & { id?: string }): LoreDoc {
    const id = draft.id ?? this.nextId();
    const doc: LoreDoc = { ...draft, id };
    this.commit([...this._lore(), doc]);
    return doc;
  }

  updateDoc(id: string, changes: Partial<Omit<LoreDoc, 'id'>>): void {
    this.commit(this._lore().map((doc) => (doc.id === id ? { ...doc, ...changes, id } : doc)));
  }

  deleteDoc(id: string): void {
    this.commit(
      this._lore()
        .filter((doc) => doc.id !== id)
        .map((doc) => ({ ...doc, relatedLoreIds: doc.relatedLoreIds.filter((related) => related !== id) })),
    );
  }

  setVisibility(id: string, visibility: Visibility): void {
    this.updateDoc(id, { visibility });
  }

  toggleVisibility(id: string): void {
    const doc = this.docById(id);
    if (doc === undefined) return;
    this.setVisibility(id, doc.visibility === 'known' ? 'hidden' : 'known');
  }

  /** Case-insensitive title search, used by the lore library list and the wiki-link resolver. */
  searchByTitle(term: string, excludeId?: string): LoreDoc[] {
    const needle = term.trim().toLowerCase();
    const pool = this.displayLore().filter((doc) => doc.id !== excludeId);
    if (needle === '') return pool.slice(0, 20);
    return pool.filter((doc) => doc.title.toLowerCase().includes(needle)).slice(0, 20);
  }

  /** Exact (case-insensitive) title match — how a `[[Wiki Link]]` token resolves to a lore page. */
  docByTitle(title: string): LoreDoc | undefined {
    const needle = title.trim().toLowerCase();
    return this.displayLore().find((doc) => doc.title.toLowerCase() === needle);
  }

  private nextId(): string {
    let counter = this._lore().length + 1;
    const taken = new Set(this._lore().map((doc) => doc.id));
    while (taken.has(`l${counter}`)) counter += 1;
    return `l${counter}`;
  }
}
