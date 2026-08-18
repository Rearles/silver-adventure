import { Component, computed, inject, signal } from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
  type AbstractControl,
  type ValidationErrors,
} from '@angular/forms';
import { Eye, EyeOff, LucideAngularModule, Trash2, type LucideIconData } from 'lucide-angular';
import {
  DYNASTY_EVENT_TYPES,
  type DynastyEvent,
  type DynastyEventType,
} from '../../models/dynasty-event';
import type { Visibility } from '../../models/person';
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
  imports: [LucideAngularModule, ReactiveFormsModule],
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
      nation: [''],
      house: [''],
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

  onToggleAddForm(): void {
    this.showAddForm.update((open) => !open);
    if (this.showAddForm()) {
      const selected = this.selectedPersonId();
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
        nation: selected === null ? '' : (this.treeData.personById(selected)?.nation ?? ''),
        house: selected === null ? '' : (this.treeData.personById(selected)?.house ?? ''),
        visibility: 'known',
      });
    }
  }

  /** A new event is linked to the currently selected person, if there is one. */
  onAddEvent(): void {
    if (this.addForm.invalid) {
      this.addForm.markAllAsTouched();
      return;
    }
    const value = this.addForm.getRawValue();
    const selected = this.selectedPersonId();

    // Day/month are precision on top of a year; without a year they are
    // meaningless — mirrors PersonForm's birth/death handling. startYear is
    // always present (required), so start day/month always apply when set.
    const endDay = value.endYear !== null ? value.endDay : null;
    const endMonth = value.endYear !== null ? value.endMonth : null;

    this.timelineData.addEvent({
      title: value.title.trim(),
      type: value.type,
      startYear: value.startYear,
      ...(value.startMonth !== null ? { startMonth: value.startMonth } : {}),
      ...(value.startDay !== null ? { startDay: value.startDay } : {}),
      ...(value.endYear !== null ? { endYear: value.endYear } : {}),
      ...(endMonth !== null ? { endMonth } : {}),
      ...(endDay !== null ? { endDay } : {}),
      // TODO(rework-event-dates plan, later steps): the form still only collects a
      // single nation/house — nations/houses are bridged from those as one-element
      // (or empty) arrays until the form gains a real multi-select tag picker.
      nations: value.nation.trim() !== '' ? [value.nation.trim()] : [],
      houses: value.house.trim() !== '' ? [value.house.trim()] : [],
      relatedPersonIds: selected === null ? [] : [selected],
      visibility: value.visibility,
      ...(value.era.trim() !== '' ? { era: value.era.trim() } : {}),
      ...(value.description.trim() !== '' ? { description: value.description.trim() } : {}),
    });

    this.showAddForm.set(false);
  }
}
