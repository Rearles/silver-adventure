import { NgStyle } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import type { PersonLike } from '../../models/person';
import { LinkPreviewService } from '../../services/link-preview.service';
import { LoreDataService } from '../../services/lore-data.service';
import { LoreUiService } from '../../services/lore-ui.service';
import { TreeDataService } from '../../services/tree-data.service';
import { WikiText } from '../wiki-text/wiki-text';

const CARD_WIDTH = 320;

/**
 * The one floating hover-preview card (see `LinkPreviewService`), mounted
 * once in `app.html` so it always renders above everything else instead of
 * being clipped by whatever scroll container the hovered link lives in.
 *
 * Positioned from the hovered link's `getBoundingClientRect()` — there's no
 * `@angular/cdk` in this project to lean on for overlay placement, so this is
 * hand-rolled: below-and-left of the anchor, clamped so it doesn't run off
 * the right edge of the viewport.
 */
@Component({
  selector: 'app-link-preview-card',
  imports: [NgStyle, WikiText],
  templateUrl: './link-preview-card.html',
  styleUrl: './link-preview-card.scss',
})
export class LinkPreviewCard {
  private readonly preview = inject(LinkPreviewService);
  private readonly treeData = inject(TreeDataService);
  private readonly loreData = inject(LoreDataService);
  private readonly loreUi = inject(LoreUiService);

  readonly target = this.preview.target;

  readonly person = computed<PersonLike | undefined>(() => {
    const t = this.target();
    return t?.kind === 'person' ? this.treeData.displayPeople().find((p) => p.id === t.id) : undefined;
  });

  readonly lore = computed(() => {
    const t = this.target();
    return t?.kind === 'lore' ? this.loreData.displayLore().find((d) => d.id === t.id) : undefined;
  });

  readonly missingTitle = computed<string | undefined>(() => {
    const t = this.target();
    return t?.kind === 'missing' ? t.title : undefined;
  });

  readonly lifespan = computed<string>(() => {
    const p = this.person();
    if (p === undefined) return '';
    if (p.birthYear !== undefined && p.deathYear !== undefined) return `${p.birthYear}–${p.deathYear}`;
    if (p.birthYear !== undefined) return `b. ${p.birthYear}`;
    if (p.deathYear !== undefined) return `d. ${p.deathYear}`;
    return '';
  });

  readonly excerpt = computed<string>(() => {
    const body = this.lore()?.body ?? '';
    return body.length > 280 ? `${body.slice(0, 280)}…` : body;
  });

  readonly style = computed<Record<string, string>>(() => {
    const rect = this.preview.anchorRect();
    if (rect === null) return { display: 'none', top: '0', left: '0' };
    const maxLeft = Math.max(8, window.innerWidth - CARD_WIDTH - 8);
    const left = Math.min(rect.left, maxLeft);
    const top = rect.bottom + 6;
    return { display: 'block', top: `${top}px`, left: `${left}px` };
  });

  onCardEnter(): void {
    this.preview.cancelHide();
  }

  onCardLeave(): void {
    this.preview.scheduleHide();
  }

  openLore(): void {
    const doc = this.lore();
    if (doc === undefined) return;
    this.preview.hideNow();
    this.loreUi.open(doc.id);
  }
}
