import { Component, computed, input, output } from '@angular/core';
import type { PersonLike } from '../../models/person';
import type { FilterTier } from '../../models/projection';

/**
 * One person's card on the tree.
 *
 * Purely presentational — it takes a `PersonLike`, which has no `gmNotes`
 * member, so the card cannot render GM prep even if asked to. GM-only affordances
 * (visibility toggles, dossier access) are gated on the `gmView` input and are
 * absent from the DOM otherwise.
 */
@Component({
  selector: 'app-person-card',
  imports: [],
  templateUrl: './person-card.html',
  styleUrl: './person-card.scss',
  host: {
    '[class.is-adjacent]': "tier() === 'adjacent'",
    '[class.is-hidden-record]': "person().visibility === 'hidden'",
    '[class.is-selected]': 'selected()',
    '[class.is-highlighted]': 'highlighted()',
    '[class.is-deceased]': '!person().isAlive',
  },
})
export class PersonCard {
  readonly person = input.required<PersonLike>();
  readonly tier = input<FilterTier>('core');
  /** When false, no GM affordance is rendered at all. */
  readonly gmView = input<boolean>(false);
  readonly selected = input<boolean>(false);
  readonly highlighted = input<boolean>(false);

  readonly select = output<string>();
  readonly editPerson = output<string>();
  readonly openDossier = output<string>();
  readonly toggleVisibility = output<string>();
  readonly toggleHideParentage = output<string>();

  /** "1402–1468", "b. 1455", or "" when no years are recorded. */
  readonly lifespan = computed<string>(() => {
    const { birthYear, deathYear } = this.person();
    if (birthYear !== undefined && deathYear !== undefined) return `${birthYear}–${deathYear}`;
    if (birthYear !== undefined) return `b. ${birthYear}`;
    if (deathYear !== undefined) return `d. ${deathYear}`;
    return '';
  });

  readonly isHiddenRecord = computed<boolean>(() => this.person().visibility === 'hidden');

  onSelect(): void {
    this.select.emit(this.person().id);
  }

  onKeydown(pressed: KeyboardEvent): void {
    if (pressed.key === 'Enter' || pressed.key === ' ') {
      pressed.preventDefault();
      this.onSelect();
    }
  }
}
