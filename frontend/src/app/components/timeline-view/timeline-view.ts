import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
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

  readonly addForm = this.formBuilder.nonNullable.group({
    title: ['', [Validators.required]],
    type: ['other' as DynastyEventType],
    year: [1500, [Validators.required]],
    era: [''],
    description: [''],
    nation: [''],
    house: [''],
    visibility: ['known' as Visibility],
  });

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
        year: this.yearBounds()?.max ?? 1500,
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

    this.timelineData.addEvent({
      title: value.title.trim(),
      type: value.type,
      year: value.year,
      relatedPersonIds: selected === null ? [] : [selected],
      visibility: value.visibility,
      ...(value.era.trim() !== '' ? { era: value.era.trim() } : {}),
      ...(value.description.trim() !== '' ? { description: value.description.trim() } : {}),
      ...(value.nation.trim() !== '' ? { nation: value.nation.trim() } : {}),
      ...(value.house.trim() !== '' ? { house: value.house.trim() } : {}),
    });

    this.showAddForm.set(false);
  }
}
