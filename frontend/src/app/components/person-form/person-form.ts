import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
  type AbstractControl,
  type ValidationErrors,
} from '@angular/forms';
import type { Person, Visibility } from '../../models/person';
import { TreeDataService } from '../../services/tree-data.service';

/** Death cannot precede birth. Reported on the group, not a single field. */
function chronologyValidator(group: AbstractControl): ValidationErrors | null {
  const birth = group.get('birthYear')?.value as number | null;
  const death = group.get('deathYear')?.value as number | null;
  if (birth === null || death === null) return null;
  return death < birth ? { chronology: true } : null;
}

/**
 * Reactive form for adding or editing a person.
 *
 * Parent and spouse links are held as signals rather than form controls: they are
 * search-and-pick chip lists, which a `FormArray` models awkwardly. Spouse
 * reciprocity is not handled here — `TreeDataService` normalises both halves of a
 * marriage on commit, so the form only records one side.
 */
@Component({
  selector: 'app-person-form',
  imports: [ReactiveFormsModule],
  templateUrl: './person-form.html',
  styleUrl: './person-form.scss',
})
export class PersonForm {
  private readonly treeData = inject(TreeDataService);
  private readonly formBuilder = inject(FormBuilder);

  /** `null` opens the form for a brand-new person. */
  readonly personId = input<string | null>(null);
  readonly closed = output<void>();
  readonly saved = output<string>();

  readonly form = this.formBuilder.nonNullable.group(
    {
      name: ['', [Validators.required, Validators.maxLength(120)]],
      house: ['', [Validators.required, Validators.maxLength(80)]],
      nation: ['', [Validators.required, Validators.maxLength(80)]],
      title: [''],
      birthYear: this.formBuilder.control<number | null>(null),
      deathYear: this.formBuilder.control<number | null>(null),
      isAlive: [true],
      generation: [0, [Validators.required]],
      successionOrder: this.formBuilder.control<number | null>(null),
      notes: [''],
      tags: [''],
      visibility: ['known' as Visibility],
      hideParentage: [false],
    },
    { validators: chronologyValidator },
  );

  readonly parentIds = signal<string[]>([]);
  readonly spouseIds = signal<string[]>([]);
  readonly parentSearch = signal<string>('');
  readonly spouseSearch = signal<string>('');

  readonly isEditing = computed<boolean>(() => this.personId() !== null);
  readonly heading = computed<string>(() =>
    this.isEditing() ? 'Edit person' : 'Add person',
  );

  /** A person may have at most two parents. */
  readonly parentsFull = computed<boolean>(() => this.parentIds().length >= 2);

  readonly parentResults = computed(() => {
    const chosen = new Set(this.parentIds());
    return this.treeData
      .searchByName(this.parentSearch(), this.personId() ?? undefined)
      .filter((candidate) => !chosen.has(candidate.id))
      .slice(0, 8);
  });

  readonly spouseResults = computed(() => {
    const chosen = new Set(this.spouseIds());
    return this.treeData
      .searchByName(this.spouseSearch(), this.personId() ?? undefined)
      .filter((candidate) => !chosen.has(candidate.id))
      .slice(0, 8);
  });

  constructor() {
    // Repopulate whenever the shell points the form at a different person.
    effect(() => {
      const id = this.personId();
      if (id === null) {
        this.resetForNew();
        return;
      }
      const person = this.treeData.personById(id);
      if (person === undefined) {
        this.resetForNew();
        return;
      }
      this.form.reset({
        name: person.name,
        house: person.house,
        nation: person.nation,
        title: person.title ?? '',
        birthYear: person.birthYear ?? null,
        deathYear: person.deathYear ?? null,
        isAlive: person.isAlive,
        generation: person.generation,
        successionOrder: person.successionOrder ?? null,
        notes: person.notes ?? '',
        tags: (person.tags ?? []).join(', '),
        visibility: person.visibility,
        hideParentage: person.hideParentage,
      });
      this.parentIds.set([...person.parentIds]);
      this.spouseIds.set([...person.spouseIds]);
      this.parentSearch.set('');
      this.spouseSearch.set('');
    });
  }

  private resetForNew(): void {
    this.form.reset({
      name: '',
      house: '',
      nation: '',
      title: '',
      birthYear: null,
      deathYear: null,
      isAlive: true,
      generation: 0,
      successionOrder: null,
      notes: '',
      tags: '',
      visibility: 'known',
      hideParentage: false,
    });
    this.parentIds.set([]);
    this.spouseIds.set([]);
    this.parentSearch.set('');
    this.spouseSearch.set('');
  }

  nameFor(id: string): string {
    return this.treeData.nameFor(id);
  }

  addParent(id: string): void {
    if (this.parentsFull()) return;
    this.parentIds.update((current) => [...current, id]);
    this.parentSearch.set('');
  }

  removeParent(id: string): void {
    this.parentIds.update((current) => current.filter((parentId) => parentId !== id));
  }

  addSpouse(id: string): void {
    this.spouseIds.update((current) => [...current, id]);
    this.spouseSearch.set('');
  }

  removeSpouse(id: string): void {
    this.spouseIds.update((current) => current.filter((spouseId) => spouseId !== id));
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    const tags = value.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag !== '');

    const draft: Omit<Person, 'id'> = {
      name: value.name.trim(),
      house: value.house.trim(),
      nation: value.nation.trim(),
      isAlive: value.isAlive,
      parentIds: this.parentIds(),
      spouseIds: this.spouseIds(),
      generation: value.generation,
      visibility: value.visibility,
      hideParentage: value.hideParentage,
      ...(value.title.trim() !== '' ? { title: value.title.trim() } : {}),
      ...(value.birthYear !== null ? { birthYear: value.birthYear } : {}),
      ...(value.deathYear !== null ? { deathYear: value.deathYear } : {}),
      ...(value.successionOrder !== null ? { successionOrder: value.successionOrder } : {}),
      ...(value.notes.trim() !== '' ? { notes: value.notes.trim() } : {}),
      ...(tags.length > 0 ? { tags } : {}),
    };

    const existingId = this.personId();
    if (existingId !== null) {
      // Preserve gmNotes: this form never touches them, the dossier owns them.
      this.treeData.updatePerson(existingId, draft);
      this.saved.emit(existingId);
    } else {
      const created = this.treeData.addPerson(draft);
      this.saved.emit(created.id);
    }
    this.closed.emit();
  }

  onCancel(): void {
    this.closed.emit();
  }

  onDelete(): void {
    const id = this.personId();
    if (id === null) return;
    this.treeData.deletePerson(id);
    this.closed.emit();
  }
}
