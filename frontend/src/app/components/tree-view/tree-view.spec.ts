import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Person } from '../../models/person';
import { TreeDataService } from '../../services/tree-data.service';
import { ViewModeService } from '../../services/view-mode.service';
import { MAX_SCALE, MIN_SCALE, SCALE_STEP, TreeView } from './tree-view';

function person(overrides: Partial<Person> & Pick<Person, 'id'>): Omit<Person, 'id'> & { id: string } {
  return {
    name: overrides.id,
    house: 'Valcrest',
    nation: 'Astyria',
    isAlive: true,
    parentIds: [],
    spouseIds: [],
    generation: 0,
    visibility: 'known',
    hideParentage: false,
    ...overrides,
  };
}

function pointerEvent(type: string, init: PointerEventInit): PointerEvent {
  return new PointerEvent(type, { pointerId: 1, button: 0, ...init });
}

/**
 * Seeds `TreeDataService` directly (no fetch/WebSocket involved — `load()` is
 * never called) so these tests exercise pan/zoom without needing to stub the
 * live API. People default to `visibility: 'known'` so they render under
 * `ViewModeService`'s default Player View without any GM-auth setup.
 */
async function createTreeView() {
  await TestBed.configureTestingModule({ imports: [TreeView] }).compileComponents();

  const treeData = TestBed.inject(TreeDataService);
  treeData.addPerson(person({ id: 'p1' }));
  treeData.addPerson(person({ id: 'p2' }));

  const fixture = TestBed.createComponent(TreeView);
  fixture.detectChanges();

  const scroller: HTMLElement = fixture.nativeElement.querySelector('.tree-scroll');
  // jsdom doesn't implement the Pointer Capture API — stub it so onPointerDown/
  // onPointerUp don't throw calling methods that don't exist on the element.
  Object.assign(scroller, { setPointerCapture: () => {}, releasePointerCapture: () => {} });

  return {
    component: fixture.componentInstance,
    scroller,
    viewMode: TestBed.inject(ViewModeService),
  };
}

describe('TreeView pan/zoom', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts at 100% zoom', async () => {
    const { component } = await createTreeView();
    expect(component.scale()).toBe(1);
  });

  it('wheel zooms in and out by SCALE_STEP, clamped to [MIN_SCALE, MAX_SCALE]', async () => {
    const { component } = await createTreeView();

    component.onWheel(new WheelEvent('wheel', { deltaY: -100 })); // up = zoom in
    expect(component.scale()).toBeCloseTo(1 + SCALE_STEP);

    component.onWheel(new WheelEvent('wheel', { deltaY: 100 })); // down = zoom out
    expect(component.scale()).toBeCloseTo(1);

    for (let i = 0; i < 50; i += 1) {
      component.onWheel(new WheelEvent('wheel', { deltaY: 100 }));
    }
    expect(component.scale()).toBe(MIN_SCALE);

    for (let i = 0; i < 50; i += 1) {
      component.onWheel(new WheelEvent('wheel', { deltaY: -100 }));
    }
    expect(component.scale()).toBe(MAX_SCALE);
  });

  it('zoomIn/zoomOut/resetZoom buttons step and clamp the same way as the wheel', async () => {
    const { component } = await createTreeView();

    component.zoomIn();
    expect(component.scale()).toBeCloseTo(1 + SCALE_STEP);

    component.zoomOut();
    component.zoomOut();
    expect(component.scale()).toBeCloseTo(1 - SCALE_STEP);

    component.resetZoom();
    expect(component.scale()).toBe(1);
  });

  it('a drag past the movement threshold pans via scrollLeft/scrollTop', async () => {
    const { component, scroller } = await createTreeView();
    scroller.scrollLeft = 0;
    scroller.scrollTop = 0;

    component.onPointerDown(pointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
    component.onPointerMove(pointerEvent('pointermove', { clientX: 60, clientY: 70 }));

    expect(scroller.scrollLeft).toBe(40); // dragged left 40px → scroll right 40px
    expect(scroller.scrollTop).toBe(30);
  });

  it('suppresses the trailing select after a real drag, but not after a plain click', async () => {
    const { component, viewMode } = await createTreeView();

    // A real drag: pointerdown, then movement past the threshold, then up.
    component.onPointerDown(pointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
    component.onPointerMove(pointerEvent('pointermove', { clientX: 40, clientY: 40 }));
    component.onPointerUp(pointerEvent('pointerup', { clientX: 40, clientY: 40 }));

    component.onSelect('p1');
    expect(viewMode.selectedPersonId()).toBeNull();

    // A plain click: pointerdown/up with no pointermove in between at all.
    component.onPointerDown(pointerEvent('pointerdown', { clientX: 200, clientY: 200 }));
    component.onPointerUp(pointerEvent('pointerup', { clientX: 200, clientY: 200 }));

    component.onSelect('p1');
    expect(viewMode.selectedPersonId()).toBe('p1');
  });
});
