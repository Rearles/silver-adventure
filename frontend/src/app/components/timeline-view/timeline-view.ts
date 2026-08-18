import { Component, computed, inject, signal } from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
  type AbstractControl,
  type ValidationErrors,
} from '@angular/forms';
import { Eye, EyeOff, LucideAngularModule, Pencil, Trash2, type LucideIconData } from 'lucide-angular';
import { DatePicker, type DatePartsValue } from '../date-picker/date-picker';
import {
  DYNASTY_EVENT_TYPES,
  type DynastyEvent,
  type DynastyEventType,
} from '../../models/dynasty-event';
import type { Visibility } from '../../models/person';
import { collectHouses } from '../../models/projection';
import { TimelineDataService } from '../../services/timeline-data.service';
import { TreeDataService } from '../../services/tree-data.service';
import { ViewModeService } from '../../services/view-mode.service';
import { eventColor, eventIcon } from './event-visuals';

interface EraGroup {
  era: string;
  events: DynastyEvent[];
}

/** Collapses a (possibly partial) day/month/year into a single comparable number. Mirrors PersonForm's helper of the same name. */
function toComparable(year: number | null, month: number | null, day: number | null): number | null {
  if (year === null) return null;
  return year * 10000 + (month ?? 1) * 100 + (day ?? 1);
}

/** End cannot precede start. Reported on the group, not a single field — mirrors PersonForm's `chronologyValidator`. */
function chronologyValidator(group: AbstractControl): ValidationErrors | null {
  const start = toComparable(
    group.get('startYear')?.value as number | null,
    group.get('startMonth')?.value as number | null,
    group.get('startDay')?.value as number | null,
  );
  const end = toComparable(
    group.get('endYear')?.value as number | null,
    group.get('endMonth')?.value as number | null,
    group.get('endDay')?.value as number | null,
  );
  if (start === null || end === null) return null;
  return end < start ? { chronology: true } : null;
}

/**
 * Vertical timeline of events, grouped by era.
 *
 * Vertical rather than horizontal: event titles stay readable without rotation,
 * and a long reign scrolls naturally in a side panel.
 *
 * The two-way link with the tree runs entirely through `ViewModeService` — this
 * component holds no reference to `TreeView`. Clicking an event publishes its
 * related person ids for the tree to highlight; a person selected in the tree
 * arrives here as a filter on `filteredEvents`.
 */
@Component({
  selector: 'app-timeline-view',
  imports: [LucideAngularModule, ReactiveFormsModule, DatePicker],
  templateUrl: './timeline-view.html',
  styleUrl: './timeline-view.scss',
})
export class TimelineView {
  private readonly timelineData = inject(TimelineDataService);
  private readonly treeData = inject(TreeDataService);
  private readonly viewMode = inject(ViewModeService);
  private readonly formBuilder = inject(FormBuilder);

  readonly eventTypes = DYNASTY_EVENT_TYPES;
  readonly EyeIcon = Eye;
  readonly EyeOffIcon = EyeOff;
  readonly TrashIcon = Trash2;
  readonly EditIcon = Pencil;

  iconFor(type: DynastyEventType): LucideIconData {
    return eventIcon(type);
  }

  /** Distinguishes "no events exist yet" from "filters matched none". */
  readonly worldIsEmpty = computed<boolean>(() => this.timelineData.gmEvents().length === 0);

  colorFor(type: DynastyEventType): string {
    return eventColor(type);
  }

  readonly isGmView = this.viewMode.isGmView;
  readonly selectedEventId = this.viewMode.selectedEventId;
  readonly selectedPersonId = this.viewMode.selectedPersonId;
  readonly yearRange = this.viewMode.yearRange;
  readonly yearBounds = this.timelineData.yearBounds;
  readonly events = this.timelineData.filteredEvents;
  readonly hiddenCount = this.timelineData.hiddenCount;
  readonly error = this.timelineData.error;

  readonly showAddForm = signal<boolean>(false);
  /** `null` while the open form is adding a new event; the event's id while editing an existing one. */
  readonly editingEventId = signal<string | null>(null);
  /** "Save changes" when editing, "Add event" when creating — same form, same submit handler either way. */
  readonly submitLabel = computed<string>(() => (this.editingEventId() === null ? 'Add event' : 'Save changes'));
  readonly formHeading = computed<string>(() => (this.editingEventId() === null ? 'New event' : 'Edit event'));

  /** Held as a signal rather than a form control, mirroring PersonForm's parent/spouse pickers — a search-and-pick chip list. */
  readonly relatedPersonIds = signal<string[]>([]);
  readonly personSearch = signal<string>('');

  readonly personResults = computed(() => {
    const chosen = new Set(this.relatedPersonIds());
    return this.treeData
      .searchByName(this.personSearch())
      .filter((candidate) => !chosen.has(candidate.id))
      .slice(0, 8);
  });

  /**
   * Nation/house timeline tags, same signal-not-form-control pattern as
   * `relatedPersonIds` above. Deliberately unscoped by the tree's current
   * nation/house filter (unlike `TreeDataService.houses`) — tagging an event
   * shouldn't be limited to whatever the GM happens to have the tree filtered
   * to right now.
   */
  readonly eventNations = signal<string[]>([]);
  readonly eventHouses = signal<string[]>([]);
  readonly nationTagSearch = signal<string>('');
  readonly houseTagSearch = signal<string>('');

  private readonly allHouses = computed<string[]>(() => collectHouses(this.treeData.gmPeople(), null));

  readonly nationTagResults = computed(() => {
    const chosen = new Set(this.eventNations());
    const term = this.nationTagSearch().trim().toLowerCase();
    return this.treeData
      .nations()
      .filter((nation) => !chosen.has(nation) && (term === '' || nation.toLowerCase().includes(term)))
      .slice(0, 8);
  });

  readonly houseTagResults = computed(() => {
    const chosen = new Set(this.eventHouses());
    const term = this.houseTagSearch().trim().toLowerCase();
    return this.allHouses()
      .filter((house) => !chosen.has(house) && (term === '' || house.toLowerCase().includes(term)))
      .slice(0, 8);
  });

  readonly addForm = this.formBuilder.nonNullable.group(
    {
      title: ['', [Validators.required]],
      type: ['other' as DynastyEventType],
      startDay: this.formBuilder.control<number | null>(null, [Validators.min(1), Validators.max(31)]),
      startMonth: this.formBuilder.control<number | null>(null, [Validators.min(1), Validators.max(12)]),
      startYear: [1500, [Validators.required]],
      endDay: this.formBuilder.control<number | null>(null, [Validators.min(1), Validators.max(31)]),
      endMonth: this.formBuilder.control<number | null>(null, [Validators.min(1), Validators.max(12)]),
      endYear: this.formBuilder.control<number | null>(null),
      era: [''],
      description: [''],
      visibility: ['known' as Visibility],
    },
    { validators: chronologyValidator },
  );

  /** Contiguous runs of the same era, so the spine gets readable section heads. */
  readonly grouped = computed<EraGroup[]>(() => {
    const groups: EraGroup[] = [];
    for (const event of this.events()) {
      const era = event.era ?? 'Undated';
      const last = groups.at(-1);
      if (last !== undefined && last.era === era) {
        last.events.push(event);
      } else {
        groups.push({ era, events: [event] });
      }
    }
    return groups;
  });

  readonly selectedPersonName = computed<string | null>(() => {
    const id = this.selectedPersonId();
    return id === null ? null : this.treeData.nameFor(id);
  });

  nameFor(personId: string): string {
    return this.treeData.nameFor(personId);
  }

  /** "1780" alone, or "1780–1785" when the event has an end year — mirrors PersonCard's birth–death formatting. */
  formatEventYears(event: DynastyEvent): string {
    return event.endYear === undefined ? `${event.startYear}` : `${event.startYear}–${event.endYear}`;
  }

  /** Clicking the selected event again clears the tree highlight. */
  onSelectEvent(event: DynastyEvent): void {
    this.viewMode.selectEvent(this.selectedEventId() === event.id ? null : event);
  }

  onClearPersonFilter(): void {
    this.viewMode.selectPerson(null);
  }

  onYearFromChange(raw: string): void {
    const parsed = raw === '' ? null : Number(raw);
    this.viewMode.setYearRange({
      from: parsed === null || Number.isNaN(parsed) ? null : parsed,
      to: this.yearRange().to,
    });
  }

  onYearToChange(raw: string): void {
    const parsed = raw === '' ? null : Number(raw);
    this.viewMode.setYearRange({
      from: this.yearRange().from,
      to: parsed === null || Number.isNaN(parsed) ? null : parsed,
    });
  }

  onClearYears(): void {
    this.viewMode.clearYearRange();
  }

  onToggleVisibility(event: DynastyEvent): void {
    this.timelineData.toggleVisibility(event.id);
  }

  onDelete(event: DynastyEvent): void {
    this.timelineData.deleteEvent(event.id);
  }

  addRelatedPerson(id: string): void {
    this.relatedPersonIds.update((current) => [...current, id]);
    this.personSearch.set('');
  }

  removeRelatedPerson(id: string): void {
    this.relatedPersonIds.update((current) => current.filter((personId) => personId !== id));
  }

  addNationTag(nation: string): void {
    this.eventNations.update((current) => [...current, nation]);
    this.nationTagSearch.set('');
  }

  removeNationTag(nation: string): void {
    this.eventNations.update((current) => current.filter((n) => n !== nation));
  }

  addHouseTag(house: string): void {
    this.eventHouses.update((current) => [...current, house]);
    this.houseTagSearch.set('');
  }

  removeHouseTag(house: string): void {
    this.eventHouses.update((current) => current.filter((h) => h !== house));
  }

  onToggleAddForm(): void {
    this.showAddForm.update((open) => !open);
    if (this.showAddForm()) {
      this.editingEventId.set(null);
      const selected = this.selectedPersonId();
      const selectedPerson = selected === null ? undefined : this.treeData.personById(selected);
      // Pre-seeded with the tree-selected person, if any — still just a starting
      // point, not a requirement; the pickers below can add or remove freely.
      this.relatedPersonIds.set(selected === null ? [] : [selected]);
      this.personSearch.set('');
      this.eventNations.set(selectedPerson === undefined ? [] : [selectedPerson.nation]);
      this.eventHouses.set(selectedPerson === undefined ? [] : [selectedPerson.house]);
      this.nationTagSearch.set('');
      this.houseTagSearch.set('');
      this.addForm.reset({
        title: '',
        type: 'other',
        startDay: null,
        startMonth: null,
        startYear: this.yearBounds()?.max ?? 1500,
        endDay: null,
        endMonth: null,
        endYear: null,
        era: '',
        description: '',
        visibility: 'known',
      });
    }
  }

  /** Opens the same form pre-filled from an existing event, for `onSubmitEvent` to update instead of create. */
  onEditEvent(event: DynastyEvent): void {
    this.editingEventId.set(event.id);
    this.relatedPersonIds.set([...event.relatedPersonIds]);
    this.personSearch.set('');
    this.eventNations.set([...event.nations]);
    this.eventHouses.set([...event.houses]);
    this.nationTagSearch.set('');
    this.houseTagSearch.set('');
    this.addForm.reset({
      title: event.title,
      type: event.type,
      startDay: event.startDay ?? null,
      startMonth: event.startMonth ?? null,
      startYear: event.startYear,
      endDay: event.endDay ?? null,
      endMonth: event.endMonth ?? null,
      endYear: event.endYear ?? null,
      era: event.era ?? '',
      description: event.description ?? '',
      visibility: event.visibility,
    });
    this.showAddForm.set(true);
  }

  /** Creates a new event, or updates the one being edited — same form, same validation, same draft shape either way. */
  onSubmitEvent(): void {
    if (this.addForm.invalid) {
      this.addForm.markAllAsTouched();
      return;
    }
    const value = this.addForm.getRawValue();

    // Day/month are precision on top of a year; without a year they are
    // meaningless — mirrors PersonForm's birth/death handling. startYear is
    // always present (required), so start day/month always apply when set.
    // Optional fields are set to `undefined` rather than omitted: updateEvent
    // merges the draft onto the existing event, so an *omitted* key would
    // silently leave a stale value in place instead of clearing it.
    const endDay = value.endYear !== null ? value.endDay : null;
    const endMonth = value.endYear !== null ? value.endMonth : null;

    const draft: Omit<DynastyEvent, 'id'> = {
      title: value.title.trim(),
      type: value.type,
      startYear: value.startYear,
      startMonth: value.startMonth ?? undefined,
      startDay: value.startDay ?? undefined,
      endYear: value.endYear ?? undefined,
      endMonth: endMonth ?? undefined,
      endDay: endDay ?? undefined,
      nations: this.eventNations(),
      houses: this.eventHouses(),
      relatedPersonIds: this.relatedPersonIds(),
      visibility: value.visibility,
      era: value.era.trim() !== '' ? value.era.trim() : undefined,
      description: value.description.trim() !== '' ? value.description.trim() : undefined,
    };

    const editingId = this.editingEventId();
    if (editingId === null) {
      this.timelineData.addEvent(draft);
    } else {
      this.timelineData.updateEvent(editingId, draft);
    }

    this.closeAddForm();
  }

  /** startYear is a required, non-nullable control — a cleared picker still writes `null` through
   *  so Validators.required catches it and the existing "A start year is required" error shows,
   *  even though the control's static type says it never holds null. */
  onStartDateChange(value: DatePartsValue): void {
    this.addForm.controls.startDay.setValue(value.day);
    this.addForm.controls.startMonth.setValue(value.month);
    this.addForm.controls.startYear.setValue(value.year as number);
    this.addForm.controls.startYear.markAsTouched();
  }

  onEndDateChange(value: DatePartsValue): void {
    this.addForm.controls.endDay.setValue(value.day);
    this.addForm.controls.endMonth.setValue(value.month);
    this.addForm.controls.endYear.setValue(value.year);
  }

  closeAddForm(): void {
    this.showAddForm.set(false);
    this.editingEventId.set(null);
    this.relatedPersonIds.set([]);
    this.personSearch.set('');
    this.eventNations.set([]);
    this.eventHouses.set([]);
    this.nationTagSearch.set('');
    this.houseTagSearch.set('');
  }
}
