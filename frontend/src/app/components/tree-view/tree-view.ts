import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { layoutTree } from '../../models/tree-layout';
import { TreeDataService } from '../../services/tree-data.service';
import { ViewModeService } from '../../services/view-mode.service';
import { PersonCard } from '../person-card/person-card';

/** Zoomed all the way out, the smallest cards' text should stay legible; zoomed all the way in, a single card should still fit the viewport comfortably. */
export const MIN_SCALE = 0.4;
export const MAX_SCALE = 2.5;
/** Step applied per wheel notch or per click of the zoom buttons. */
export const SCALE_STEP = 0.15;

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

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
  private readonly injector = inject(Injector);

  /** Bubbled to the shell, which owns the form and dossier panels. */
  readonly editPerson = output<string>();
  readonly openDossier = output<string>();

  readonly isGmView = this.viewMode.isGmView;
  readonly selectedPersonId = this.viewMode.selectedPersonId;
  readonly highlightedPersonIds = this.viewMode.highlightedPersonIds;

  readonly layout = computed(() => layoutTree(this.treeData.filteredPeople()));

  /** Current zoom level of the tree canvas; 1 = 100%. Panning is native scroll, so it has no signal of its own. */
  private readonly _scale = signal<number>(1);
  readonly scale = this._scale.asReadonly();

  /**
   * Distinguishes "the world has no one at all" from "the filter matched no
   * one" — an empty tree needs different guidance in each case, and the
   * former is expected right after wiping or starting a new world.
   */
  readonly worldIsEmpty = computed<boolean>(() => this.treeData.count() === 0);

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  /** Movement (px) below which a pointerdown→pointerup is still treated as a click, not a drag. */
  private static readonly DRAG_THRESHOLD = 4;

  /** In-progress drag-to-pan gesture; imperative-only, never read from the template. */
  private dragState: {
    pointerId: number;
    startX: number;
    startY: number;
    startScrollLeft: number;
    startScrollTop: number;
    moved: boolean;
  } | null = null;

  /** True only while a drag has actually moved past the threshold — drives the grab/grabbing cursor. */
  private readonly _isDragging = signal<boolean>(false);
  readonly isDragging = this._isDragging.asReadonly();

  /** Consumed by the next `onSelect` so the card under the pointer isn't also selected right after a drag. */
  private suppressNextSelect = false;

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
    if (this.suppressNextSelect) {
      this.suppressNextSelect = false;
      return;
    }
    this.viewMode.selectPerson(this.selectedPersonId() === personId ? null : personId);
  }

  /** Starts tracking a possible drag-to-pan gesture. Left button/primary touch/pen only. */
  onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const host = this.scroller()?.nativeElement;
    if (host === undefined) return;

    this.dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: host.scrollLeft,
      startScrollTop: host.scrollTop,
      moved: false,
    };
    host.setPointerCapture(event.pointerId);
  }

  /** Below the drag threshold this is a no-op, so a plain click still reaches `onSelect` untouched. */
  onPointerMove(event: PointerEvent): void {
    const drag = this.dragState;
    const host = this.scroller()?.nativeElement;
    if (drag === null || host === undefined || event.pointerId !== drag.pointerId) return;

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < TreeView.DRAG_THRESHOLD) return;

    drag.moved = true;
    this._isDragging.set(true);
    host.scrollLeft = drag.startScrollLeft - dx;
    host.scrollTop = drag.startScrollTop - dy;
  }

  /** Ends the gesture; a real drag arms `suppressNextSelect` so the trailing click doesn't also select a card. */
  onPointerUp(event: PointerEvent): void {
    const drag = this.dragState;
    if (drag === null || event.pointerId !== drag.pointerId) return;

    if (drag.moved) this.suppressNextSelect = true;
    this.scroller()?.nativeElement.releasePointerCapture(event.pointerId);
    this.dragState = null;
    this._isDragging.set(false);
  }

  /**
   * Scroll wheel zooms (this canvas has no other use for it — panning is
   * drag, not wheel-scroll), keeping the point under the cursor visually
   * fixed rather than zooming toward the canvas origin.
   */
  onWheel(event: WheelEvent): void {
    const host = this.scroller()?.nativeElement;
    if (host === undefined) return;
    event.preventDefault();

    const previousScale = this._scale();
    const direction = event.deltaY > 0 ? -1 : 1;
    const nextScale = clampScale(previousScale + direction * SCALE_STEP);
    if (nextScale === previousScale) return;

    const rect = host.getBoundingClientRect();
    const viewportX = event.clientX - rect.left;
    const viewportY = event.clientY - rect.top;

    // The cursor's position in unscaled canvas coordinates — this is what
    // stays fixed on screen as `scale()` changes.
    const canvasX = (host.scrollLeft + viewportX) / previousScale;
    const canvasY = (host.scrollTop + viewportY) / previousScale;

    this._scale.set(nextScale);

    // The sizer's width/height (and thus the scrollable range) only reflect
    // the new scale after Angular re-renders — deferring past that render is
    // what keeps this assignment from being silently clamped to the old size.
    afterNextRender(
      () => {
        host.scrollLeft = canvasX * nextScale - viewportX;
        host.scrollTop = canvasY * nextScale - viewportY;
      },
      { injector: this.injector },
    );
  }

  onToggleVisibility(personId: string): void {
    this.treeData.toggleVisibility(personId);
  }

  onToggleHideParentage(personId: string): void {
    this.treeData.toggleHideParentage(personId);
  }
}
