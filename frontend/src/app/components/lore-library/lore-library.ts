import { Component, computed, effect, inject, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { BookOpen, Eye, EyeOff, LucideAngularModule, Pencil, Plus, Trash2, X } from 'lucide-angular';
import { LORE_DOC_TYPES, type LoreDoc, type LoreDocType } from '../../models/lore-doc';
import type { Visibility } from '../../models/person';
import { LoreDataService } from '../../services/lore-data.service';
import { LoreUiService } from '../../services/lore-ui.service';
import { TimelineDataService } from '../../services/timeline-data.service';
import { TreeDataService } from '../../services/tree-data.service';
import { ViewModeService } from '../../services/view-mode.service';
import { WikiText } from '../wiki-text/wiki-text';

type LibraryMode = 'list' | 'article' | 'edit';

/** Sentinel id for "creating a brand-new doc" — never a real `LoreDoc.id`. */
const NEW_DOC = '__new__';

/**
 * The lore pages surface: a searchable list of Houses/Nations + standalone
 * topic pages, an article view (rendered through `WikiText` so links inside a
 * lore body are themselves hoverable/clickable), and — GM View only — a
 * create/edit/delete/visibility-toggle form. Mounted once in `app.html`
 * behind a header toggle, same drawer/modal convention as `GmDossier` and
 * `PersonForm`, except (unlike those two) it is visible to players too, just
 * without the editing affordances.
 *
 * `LoreUiService.openDocId` is how the rest of the app ("open this lore
 * page") reaches in — a `[[Wiki Link]]` click anywhere sets it, and this
 * component reacts by jumping straight to that doc's article view.
 */
@Component({
  selector: 'app-lore-library',
  imports: [ReactiveFormsModule, LucideAngularModule, WikiText],
  templateUrl: './lore-library.html',
  styleUrl: './lore-library.scss',
})
export class LoreLibrary {
  private readonly loreData = inject(LoreDataService);
  private readonly loreUi = inject(LoreUiService);
  private readonly treeData = inject(TreeDataService);
  private readonly timelineData = inject(TimelineDataService);
  private readonly viewMode = inject(ViewModeService);
  private readonly formBuilder = inject(FormBuilder);

  readonly BookOpenIcon = BookOpen;
  readonly CloseIcon = X;
  readonly PlusIcon = Plus;
  readonly PencilIcon = Pencil;
  readonly TrashIcon = Trash2;
  readonly EyeIcon = Eye;
  readonly EyeOffIcon = EyeOff;

  readonly closed = output<void>();

  readonly isGmView = this.viewMode.isGmView;
  readonly docTypes = LORE_DOC_TYPES;

  readonly mode = signal<LibraryMode>('list');
  readonly selectedId = signal<string | null>(null);
  readonly search = signal<string>('');
  readonly typeFilter = signal<LoreDocType | 'all'>('all');

  readonly filteredDocs = computed<LoreDoc[]>(() => {
    const needle = this.search().trim().toLowerCase();
    const type = this.typeFilter();
    return this.loreData
      .displayLore()
      .filter((doc) => type === 'all' || doc.type === type)
      .filter((doc) => needle === '' || doc.title.toLowerCase().includes(needle))
      .sort((a, b) => a.title.localeCompare(b.title));
  });

  readonly selectedDoc = computed<LoreDoc | undefined>(() => {
    const id = this.selectedId();
    return id === null ? undefined : this.loreData.docById(id);
  });

  readonly relatedPeople = computed(() => {
    const doc = this.selectedDoc();
    if (doc === undefined) return [];
    return doc.relatedPersonIds
      .map((id) => this.treeData.personById(id))
      .filter((p): p is NonNullable<typeof p> => p !== undefined);
  });

  readonly relatedEvents = computed(() => {
    const doc = this.selectedDoc();
    if (doc === undefined) return [];
    return doc.relatedEventIds
      .map((id) => this.timelineData.eventById(id))
      .filter((e): e is NonNullable<typeof e> => e !== undefined);
  });

  readonly relatedLore = computed(() => {
    const doc = this.selectedDoc();
    if (doc === undefined) return [];
    return doc.relatedLoreIds
      .map((id) => this.loreData.docById(id))
      .filter((d): d is LoreDoc => d !== undefined);
  });

  // --- Edit form -----------------------------------------------------------

  readonly form = this.formBuilder.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(120)]],
    type: this.formBuilder.nonNullable.control<LoreDocType>('topic'),
    subjectName: [''],
    body: [''],
    visibility: this.formBuilder.nonNullable.control<Visibility>('known'),
  });

  readonly relatedPersonIds = signal<string[]>([]);
  readonly relatedEventIds = signal<string[]>([]);
  readonly relatedLoreIds = signal<string[]>([]);
  readonly personSearch = signal<string>('');
  readonly eventSearch = signal<string>('');
  readonly loreSearch = signal<string>('');

  readonly personResults = computed(() => {
    const chosen = new Set(this.relatedPersonIds());
    return this.treeData
      .searchByName(this.personSearch())
      .filter((p) => !chosen.has(p.id))
      .slice(0, 8);
  });

  readonly eventResults = computed(() => {
    const needle = this.eventSearch().trim().toLowerCase();
    const chosen = new Set(this.relatedEventIds());
    return this.timelineData
      .displayEvents()
      .filter((e) => !chosen.has(e.id))
      .filter((e) => needle === '' || e.title.toLowerCase().includes(needle))
      .slice(0, 8);
  });

  readonly loreResults = computed(() => {
    const chosen = new Set(this.relatedLoreIds());
    const editingId = this.selectedId();
    return this.loreData
      .searchByTitle(this.loreSearch(), editingId === NEW_DOC ? undefined : (editingId ?? undefined))
      .filter((d) => !chosen.has(d.id));
  });

  constructor() {
    // A wiki-link click elsewhere in the app opens the library straight to a doc.
    effect(() => {
      const id = this.loreUi.openDocId();
      if (id === null) return;
      this.selectedId.set(id);
      this.mode.set('article');
    });
  }

  nameFor(id: string): string {
    return this.treeData.nameFor(id);
  }

  eventTitleFor(id: string): string {
    return this.timelineData.eventById(id)?.title ?? id;
  }

  loreTitleFor(id: string): string {
    return this.loreData.docById(id)?.title ?? id;
  }

  onSearch(value: string): void {
    this.search.set(value);
  }

  onFilterType(type: LoreDocType | 'all'): void {
    this.typeFilter.set(type);
  }

  openDoc(id: string): void {
    this.selectedId.set(id);
    this.mode.set('article');
  }

  backToList(): void {
    this.selectedId.set(null);
    this.mode.set('list');
  }

  startCreate(): void {
    this.form.reset({ title: '', type: 'topic', subjectName: '', body: '', visibility: 'known' });
    this.relatedPersonIds.set([]);
    this.relatedEventIds.set([]);
    this.relatedLoreIds.set([]);
    this.personSearch.set('');
    this.eventSearch.set('');
    this.loreSearch.set('');
    this.selectedId.set(NEW_DOC);
    this.mode.set('edit');
  }

  startEdit(): void {
    const doc = this.selectedDoc();
    if (doc === undefined) return;
    this.form.reset({
      title: doc.title,
      type: doc.type,
      subjectName: doc.subjectName ?? '',
      body: doc.body,
      visibility: doc.visibility,
    });
    this.relatedPersonIds.set([...doc.relatedPersonIds]);
    this.relatedEventIds.set([...doc.relatedEventIds]);
    this.relatedLoreIds.set([...doc.relatedLoreIds]);
    this.personSearch.set('');
    this.eventSearch.set('');
    this.loreSearch.set('');
    this.mode.set('edit');
  }

  cancelEdit(): void {
    const id = this.selectedId();
    if (id === NEW_DOC) {
      this.backToList();
      return;
    }
    this.mode.set('article');
  }

  addPerson(id: string): void {
    this.relatedPersonIds.update((ids) => [...ids, id]);
    this.personSearch.set('');
  }

  removePerson(id: string): void {
    this.relatedPersonIds.update((ids) => ids.filter((existing) => existing !== id));
  }

  addEvent(id: string): void {
    this.relatedEventIds.update((ids) => [...ids, id]);
    this.eventSearch.set('');
  }

  removeEvent(id: string): void {
    this.relatedEventIds.update((ids) => ids.filter((existing) => existing !== id));
  }

  addLore(id: string): void {
    this.relatedLoreIds.update((ids) => [...ids, id]);
    this.loreSearch.set('');
  }

  removeLore(id: string): void {
    this.relatedLoreIds.update((ids) => ids.filter((existing) => existing !== id));
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    const trimmedSubject = value.subjectName.trim();
    // `subjectName` is explicit `undefined` (never an omitted key) so an edit that
    // clears the field actually clears it — `updateDoc` merges via `{...doc, ...changes}`,
    // where an omitted key leaves the existing value in place but an explicit `undefined`
    // overwrites it. See lesson lsn_d6bc7bf5a4c5.
    const draft: Omit<LoreDoc, 'id'> = {
      title: value.title.trim(),
      type: value.type,
      subjectName: trimmedSubject !== '' ? trimmedSubject : undefined,
      body: value.body.trim(),
      visibility: value.visibility,
      relatedPersonIds: this.relatedPersonIds(),
      relatedEventIds: this.relatedEventIds(),
      relatedLoreIds: this.relatedLoreIds(),
    };

    const id = this.selectedId();
    if (id !== null && id !== NEW_DOC) {
      this.loreData.updateDoc(id, draft);
      this.selectedId.set(id);
    } else {
      const created = this.loreData.addDoc(draft);
      this.selectedId.set(created.id);
    }
    this.mode.set('article');
  }

  onDelete(): void {
    const id = this.selectedId();
    if (id === null || id === NEW_DOC) return;
    this.loreData.deleteDoc(id);
    this.backToList();
  }

  onToggleVisibility(): void {
    const id = this.selectedId();
    if (id === null || id === NEW_DOC) return;
    this.loreData.toggleVisibility(id);
  }

  onClose(): void {
    this.loreUi.close();
    this.mode.set('list');
    this.selectedId.set(null);
    this.closed.emit();
  }
}
