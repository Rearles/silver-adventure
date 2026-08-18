import { Injectable, signal } from '@angular/core';

export type LinkPreviewTarget =
  | { kind: 'person'; id: string }
  | { kind: 'lore'; id: string }
  | { kind: 'missing'; title: string };

/**
 * The one floating hover-preview card, shared app-wide — mounted once in
 * `app.html` (see `LinkPreviewCard`) rather than once per `WikiText`
 * instance, so a link inside the preview card itself can retarget the same
 * card (see the screenshot's "hover House of Milltree, then hover a name
 * inside that popup" cascade) without stacking N floating elements.
 *
 * Timing is delay-in / delay-out rather than instant, so a mouse passing
 * over a link on its way somewhere else doesn't flash a card, and moving the
 * pointer from the link onto the card itself (to click something in it, or
 * to hover a nested link) doesn't dismiss it mid-transit.
 */
@Injectable({ providedIn: 'root' })
export class LinkPreviewService {
  private readonly _target = signal<LinkPreviewTarget | null>(null);
  private readonly _anchorRect = signal<DOMRect | null>(null);

  readonly target = this._target.asReadonly();
  readonly anchorRect = this._anchorRect.asReadonly();

  private showTimer: ReturnType<typeof setTimeout> | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  /** Called on hover/focus of a wiki-link. `anchor` positions the card. */
  show(target: LinkPreviewTarget, anchor: HTMLElement): void {
    this.cancelHide();
    if (this.showTimer !== null) clearTimeout(this.showTimer);
    const rect = anchor.getBoundingClientRect();
    this.showTimer = setTimeout(() => {
      this._target.set(target);
      this._anchorRect.set(rect);
    }, 120);
  }

  /** Called on hover-out. Gives `cancelHide()` a window to save the card if the pointer lands on it. */
  scheduleHide(): void {
    if (this.showTimer !== null) {
      clearTimeout(this.showTimer);
      this.showTimer = null;
    }
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      this._target.set(null);
      this._anchorRect.set(null);
    }, 250);
  }

  /** Called on hover-in to the card itself, or a nested link inside it. */
  cancelHide(): void {
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  hideNow(): void {
    if (this.showTimer !== null) clearTimeout(this.showTimer);
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    this.showTimer = null;
    this.hideTimer = null;
    this._target.set(null);
    this._anchorRect.set(null);
  }
}
