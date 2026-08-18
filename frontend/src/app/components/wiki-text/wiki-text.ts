import { Component, computed, inject, input } from '@angular/core';
import type { LinkPreviewTarget } from '../../services/link-preview.service';
import { LinkPreviewService } from '../../services/link-preview.service';
import { LoreDataService } from '../../services/lore-data.service';
import { LoreUiService } from '../../services/lore-ui.service';
import { TreeDataService } from '../../services/tree-data.service';
import { ViewModeService } from '../../services/view-mode.service';

interface TextSegment {
  kind: 'text';
  value: string;
}
interface LinkSegment {
  kind: 'link';
  raw: string;
  target: LinkPreviewTarget;
}
type Segment = TextSegment | LinkSegment;

const WIKI_LINK = /\[\[([^\]]+)\]\]/g;

/**
 * Renders a free-text field (lore body, person notes, event description)
 * with `[[Wiki Link]]` tokens turned into hoverable/clickable links.
 *
 * Deliberately minimal beyond the link syntax — paragraph breaks (blank
 * lines) become `<p>`s, everything else is plain text. No bold/italic/list
 * markdown yet; the wiki-link is the part of "markdown body" this feature
 * actually needs, and a fuller renderer can layer on top later without
 * touching the link-resolution logic here.
 *
 * A token that doesn't match any person name or lore title still renders as
 * a link (styled distinctly) rather than falling back to plain text — a
 * broken/not-yet-written link should be visible, not silently swallowed, the
 * same way Obsidian/Roam treat an unresolved `[[link]]`.
 */
@Component({
  selector: 'app-wiki-text',
  imports: [],
  templateUrl: './wiki-text.html',
  styleUrl: './wiki-text.scss',
})
export class WikiText {
  private readonly treeData = inject(TreeDataService);
  private readonly loreData = inject(LoreDataService);
  private readonly loreUi = inject(LoreUiService);
  private readonly viewMode = inject(ViewModeService);
  private readonly preview = inject(LinkPreviewService);

  readonly text = input<string>('');

  readonly paragraphs = computed<Segment[][]>(() =>
    this.text()
      .split(/\n{2,}/)
      .map((block) => this.parseBlock(block))
      .filter((segments) => segments.length > 0),
  );

  private parseBlock(block: string): Segment[] {
    const segments: Segment[] = [];
    let lastIndex = 0;
    for (const match of block.matchAll(WIKI_LINK)) {
      const [raw, title] = match;
      const start = match.index ?? 0;
      if (start > lastIndex) {
        segments.push({ kind: 'text', value: block.slice(lastIndex, start) });
      }
      segments.push({ kind: 'link', raw: title.trim(), target: this.resolve(title.trim()) });
      lastIndex = start + raw.length;
    }
    if (lastIndex < block.length) {
      segments.push({ kind: 'text', value: block.slice(lastIndex) });
    }
    return segments;
  }

  private resolve(title: string): LinkPreviewTarget {
    const person = this.treeData.displayPeople().find((p) => p.name.toLowerCase() === title.toLowerCase());
    if (person !== undefined) return { kind: 'person', id: person.id };
    const doc = this.loreData.docByTitle(title);
    if (doc !== undefined) return { kind: 'lore', id: doc.id };
    return { kind: 'missing', title };
  }

  onEnter(event: FocusEvent | MouseEvent, segment: LinkSegment): void {
    this.preview.show(segment.target, event.currentTarget as HTMLElement);
  }

  onLeave(): void {
    this.preview.scheduleHide();
  }

  onClick(segment: LinkSegment): void {
    this.preview.hideNow();
    if (segment.target.kind === 'person') {
      this.viewMode.selectPerson(segment.target.id);
    } else if (segment.target.kind === 'lore') {
      this.loreUi.open(segment.target.id);
    }
  }
}
