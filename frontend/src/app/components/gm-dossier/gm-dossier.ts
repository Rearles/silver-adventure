import { Component, computed, effect, inject, input, output } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import {
  Crown,
  Flag,
  Handshake,
  LucideAngularModule,
  Swords,
  Target,
  User,
  X,
} from 'lucide-angular';
import { houseColor } from '../../models/house-colors';
import type { GmNotes } from '../../models/person';
import { TreeDataService } from '../../services/tree-data.service';
import { ViewModeService } from '../../services/view-mode.service';

/** Splits a comma-separated field into a trimmed list, dropping blanks. */
function toList(raw: string): string[] {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

/**
 * GM-only prep panel for one person's `gmNotes`.
 *
 * The shell renders this component **only** in GM View, so in Player Preview it
 * does not exist in the component tree or the DOM at all — its content is prep
 * material for the GM, not plot-secret content that might later be revealed. The
 * `isGmView` guard in the template is a second line of defence in case a future
 * caller forgets the gate.
 */
@Component({
  selector: 'app-gm-dossier',
  imports: [LucideAngularModule, ReactiveFormsModule],
  templateUrl: './gm-dossier.html',
  styleUrl: './gm-dossier.scss',
})
export class GmDossier {
  private readonly treeData = inject(TreeDataService);
  private readonly viewMode = inject(ViewModeService);
  private readonly formBuilder = inject(FormBuilder);

  readonly UserIcon = User;
  readonly CrownIcon = Crown;
  readonly HandshakeIcon = Handshake;
  readonly SwordsIcon = Swords;
  readonly TargetIcon = Target;
  readonly FlagIcon = Flag;
  readonly CloseIcon = X;

  readonly personId = input.required<string>();
  readonly closed = output<void>();

  readonly isGmView = this.viewMode.isGmView;

  readonly houseColor = computed<string>(() => {
    const subject = this.treeData.personById(this.personId());
    return subject === undefined ? '#8a8272' : houseColor(subject.house);
  });

  readonly form = this.formBuilder.nonNullable.group({
    personalityTraits: [''],
    physicalDescription: [''],
    allies: [''],
    enemies: [''],
    motivations: [''],
    goals: [''],
    ambitions: [''],
    secrets: [''],
  });

  readonly person = computed(() => this.treeData.personById(this.personId()));

  constructor() {
    effect(() => {
      const notes = this.treeData.gmNotesFor(this.personId()) ?? {};
      this.form.reset({
        personalityTraits: (notes.personalityTraits ?? []).join(', '),
        physicalDescription: notes.physicalDescription ?? '',
        allies: (notes.allies ?? []).join(', '),
        enemies: (notes.enemies ?? []).join(', '),
        motivations: notes.motivations ?? '',
        goals: notes.goals ?? '',
        ambitions: notes.ambitions ?? '',
        secrets: notes.secrets ?? '',
      });
    });
  }

  /** Resolves an ally/enemy entry that happens to be a person id to their name. */
  labelFor(entry: string): string {
    const match = this.treeData.personById(entry);
    return match === undefined ? entry : match.name;
  }

  /**
   * Only worth showing when at least one entry is a person id that resolved to a
   * name — otherwise the line just echoes the free text back verbatim.
   */
  private resolvedNames(raw: string): string[] {
    const entries = toList(raw);
    const anyResolved = entries.some((entry) => this.treeData.personById(entry) !== undefined);
    return anyResolved ? entries.map((entry) => this.labelFor(entry)) : [];
  }

  readonly allyLabels = computed<string[]>(() =>
    this.resolvedNames(this.form.controls.allies.value),
  );
  readonly enemyLabels = computed<string[]>(() =>
    this.resolvedNames(this.form.controls.enemies.value),
  );

  onSave(): void {
    const value = this.form.getRawValue();
    const traits = toList(value.personalityTraits);
    const allies = toList(value.allies);
    const enemies = toList(value.enemies);

    // Omit empty fields rather than storing empty strings, so the JSON stays clean.
    const notes: GmNotes = {
      ...(traits.length > 0 ? { personalityTraits: traits } : {}),
      ...(value.physicalDescription.trim() !== ''
        ? { physicalDescription: value.physicalDescription.trim() }
        : {}),
      ...(allies.length > 0 ? { allies } : {}),
      ...(enemies.length > 0 ? { enemies } : {}),
      ...(value.motivations.trim() !== '' ? { motivations: value.motivations.trim() } : {}),
      ...(value.goals.trim() !== '' ? { goals: value.goals.trim() } : {}),
      ...(value.ambitions.trim() !== '' ? { ambitions: value.ambitions.trim() } : {}),
      ...(value.secrets.trim() !== '' ? { secrets: value.secrets.trim() } : {}),
    };

    this.treeData.updateGmNotes(this.personId(), notes);
    this.form.markAsPristine();
  }

  onClose(): void {
    this.closed.emit();
  }

  onToggleVisibility(): void {
    this.treeData.toggleVisibility(this.personId());
  }

  onToggleHideParentage(): void {
    this.treeData.toggleHideParentage(this.personId());
  }
}
