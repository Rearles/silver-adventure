import { Injectable, signal } from '@angular/core';

/**
 * Tiny switchboard for "open the lore library to this page" — clicking a
 * `[[Wiki Link]]` anywhere in the app (a person's notes, an event
 * description, another lore page) needs to open `LoreLibrary` and select a
 * doc without either component reaching into the other directly.
 */
@Injectable({ providedIn: 'root' })
export class LoreUiService {
  private readonly _openDocId = signal<string | null>(null);
  /** Non-null means "the lore library should be open, showing this doc." Set to null to close it. */
  readonly openDocId = this._openDocId.asReadonly();

  open(docId: string | null): void {
    this._openDocId.set(docId);
  }

  close(): void {
    this._openDocId.set(null);
  }
}
