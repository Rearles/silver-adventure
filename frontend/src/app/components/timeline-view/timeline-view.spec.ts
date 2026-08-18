import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Person } from '../../models/person';
import { TimelineDataService } from '../../services/timeline-data.service';
import { TreeDataService } from '../../services/tree-data.service';
import { TimelineView } from './timeline-view';

function person(overrides: Partial<Person> & Pick<Person, 'id'>): Omit<Person, 'id'> & { id: string } {
  return {
    name: overrides.id,
    house: 'Milltree',
    nation: 'Asha',
    isAlive: true,
    parentIds: [],
    spouseIds: [],
    generation: 0,
    visibility: 'known',
    hideParentage: false,
    ...overrides,
  };
}

/**
 * Seeds TreeDataService/TimelineDataService directly (no fetch/WebSocket
 * involved — load() is never called), mirroring tree-view.spec.ts. People
 * default to visibility: 'known' so searchByName finds them under the
 * default Player View mode without any GM-auth setup.
 */
async function createTimelineView() {
  await TestBed.configureTestingModule({ imports: [TimelineView] }).compileComponents();

  const treeData = TestBed.inject(TreeDataService);
  const p1 = treeData.addPerson(person({ id: 'p1', name: 'Connor Chambers' }));
  const p2 = treeData.addPerson(person({ id: 'p2', name: 'Sarah Chambers' }));

  const fixture = TestBed.createComponent(TimelineView);
  fixture.detectChanges();

  return {
    component: fixture.componentInstance,
    timelineData: TestBed.inject(TimelineDataService),
    p1,
    p2,
  };
}

describe('TimelineView add/edit form', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('date validation', () => {
    it('requires a title and a start year, but not an end year', async () => {
      const { component } = await createTimelineView();
      component.onToggleAddForm();

      expect(component.addForm.controls.title.valid).toBe(false);
      expect(component.addForm.controls.startYear.valid).toBe(true); // has a default
      expect(component.addForm.controls.endYear.valid).toBe(true); // optional, null is fine

      component.addForm.patchValue({ title: 'Coronation' });
      expect(component.addForm.valid).toBe(true);
    });

    it('flags chronology when the end date precedes the start date', async () => {
      const { component } = await createTimelineView();
      component.onToggleAddForm();
      component.addForm.patchValue({ title: 'A war', startYear: 1800, endYear: 1750 });

      expect(component.addForm.errors?.['chronology']).toBe(true);

      component.addForm.patchValue({ endYear: 1810 });
      expect(component.addForm.errors?.['chronology']).toBeUndefined();
    });

    it('does not submit an invalid form', async () => {
      const { component, timelineData } = await createTimelineView();
      component.onToggleAddForm();
      // Title left blank.
      component.onSubmitEvent();

      expect(timelineData.gmEvents()).toHaveLength(0);
      expect(component.addForm.controls.title.touched).toBe(true);
    });
  });

  describe('multi-person linking', () => {
    it('links every person added via the picker, not just one', async () => {
      const { component, timelineData, p1, p2 } = await createTimelineView();
      component.onToggleAddForm();
      component.addForm.patchValue({ title: 'A royal wedding' });
      component.addRelatedPerson(p1.id);
      component.addRelatedPerson(p2.id);
      component.onSubmitEvent();

      const [event] = timelineData.gmEvents();
      expect(event.relatedPersonIds).toEqual([p1.id, p2.id]);
    });

    it('removeRelatedPerson drops a person before submit', async () => {
      const { component, timelineData, p1, p2 } = await createTimelineView();
      component.onToggleAddForm();
      component.addForm.patchValue({ title: 'A royal wedding' });
      component.addRelatedPerson(p1.id);
      component.addRelatedPerson(p2.id);
      component.removeRelatedPerson(p1.id);
      component.onSubmitEvent();

      const [event] = timelineData.gmEvents();
      expect(event.relatedPersonIds).toEqual([p2.id]);
    });
  });

  describe('nation/house timeline tags', () => {
    it('tags an event with multiple nations and houses', async () => {
      const { component, timelineData } = await createTimelineView();
      component.onToggleAddForm();
      component.addForm.patchValue({ title: 'A treaty' });
      component.addNationTag('Asha');
      component.addNationTag('Ethos');
      component.addHouseTag('Milltree');
      component.onSubmitEvent();

      const [event] = timelineData.gmEvents();
      expect(event.nations).toEqual(['Asha', 'Ethos']);
      expect(event.houses).toEqual(['Milltree']);
    });
  });

  describe('editing an existing event', () => {
    it('updates the event in place rather than creating a duplicate', async () => {
      const { component, timelineData, p1 } = await createTimelineView();
      const original = timelineData.addEvent({
        title: 'Original title',
        type: 'other',
        startYear: 1700,
        era: 'The Founding',
        nations: ['Asha'],
        houses: [],
        relatedPersonIds: [p1.id],
        visibility: 'known',
      });

      component.onEditEvent(original);
      expect(component.addForm.value.title).toBe('Original title');
      expect(component.relatedPersonIds()).toEqual([p1.id]);
      expect(component.eventNations()).toEqual(['Asha']);

      component.addForm.patchValue({ title: 'Renamed title' });
      component.onSubmitEvent();

      expect(timelineData.gmEvents()).toHaveLength(1);
      expect(timelineData.eventById(original.id)?.title).toBe('Renamed title');
    });

    it('actually clears an optional field left blank in the edit form, rather than leaving the old value', async () => {
      const { component, timelineData, p1 } = await createTimelineView();
      const original = timelineData.addEvent({
        title: 'Has an era',
        type: 'other',
        startYear: 1700,
        era: 'The Founding',
        nations: [],
        houses: [],
        relatedPersonIds: [p1.id],
        visibility: 'known',
      });

      component.onEditEvent(original);
      component.addForm.patchValue({ era: '' }); // clear it
      component.onSubmitEvent();

      expect(timelineData.eventById(original.id)?.era).toBeUndefined();
    });
  });
});
