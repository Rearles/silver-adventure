import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  output,
  viewChild,
} from '@angular/core';
import { layoutTree } from '../../models/tree-layout';
import { TreeDataService } from '../../services/tree-data.service';
import { ViewModeService } from '../../services/view-mode.service';
import { PersonCard } from '../person-card/person-card';

/**
 * Renders the family tree from the currently filtered pool.
 *
 * Geometry comes from `layoutTree`; this component only draws it. Connectors are
 * a single SVG layer underneath absolutely-positioned HTML cards, which keeps the
 * lines crisp while leaving the cards stylable with ordinary CSS.
 */
@Component({
  selector: 'app-tree-view',
  imports: [PersonCard],
  templateUrl: './tree-view.html',
  styleUrl: './tree-view.scss',
})
export class TreeView {
  private readonly treeData = inject(TreeDataService);
  private readonly viewMode = inject(ViewModeService);

  /** Bubbled to the shell, which owns the form and dossier panels. */
  readonly editPerson = output<string>();
  readonly openDossier = output<string>();

  readonly isGmView = this.viewMode.isGmView;
  readonly selectedPersonId = this.viewMode.selectedPersonId;
  readonly highlightedPersonIds = this.viewMode.highlightedPersonIds;

  readonly layout = computed(() => layoutTree(this.treeData.filteredPeople()));

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  constructor() {
    // Timeline → tree: centre the first person an event refers to.
    effect(() => {
      const highlighted = this.highlightedPersonIds();
      if (highlighted.size === 0) return;

      const target = this.layout().nodes.find((node) => highlighted.has(node.person.id));
      const host = this.scroller()?.nativeElement;
      if (target === undefined || host === undefined) return;

      const left = target.x + target.width / 2 - host.clientWidth / 2;
      const top = target.y + target.height / 2 - host.clientHeight / 2;

      // This runs inside change detection, so it must not throw where
      // Element.scrollTo is missing (jsdom, older browsers) — fall back to
      // setting the scroll offsets directly.
      if (typeof host.scrollTo === 'function') {
        host.scrollTo({ left, top, behavior: 'smooth' });
      } else {
        host.scrollLeft = left;
        host.scrollTop = top;
      }
    });
  }

  isHighlighted(personId: string): boolean {
    return this.highlightedPersonIds().has(personId);
  }

  /**
   * With an event selected, everyone it does not involve dims back, so the
   * people it touches read immediately. No selection means no dimming.
   */
  isDimmed(personId: string): boolean {
    const highlighted = this.highlightedPersonIds();
    return highlighted.size > 0 && !highlighted.has(personId);
  }

  /** Clicking the selected person again clears the selection. */
  onSelect(personId: string): void {
    this.viewMode.selectPerson(this.selectedPersonId() === personId ? null : personId);
  }

  onToggleVisibility(personId: string): void {
    this.treeData.toggleVisibility(personId);
  }

  onToggleHideParentage(personId: string): void {
    this.treeData.toggleHideParentage(personId);
  }
}
