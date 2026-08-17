import { Component, computed, input, output } from '@angular/core';
import { Eye, EyeOff, Lock, LockOpen, LucideAngularModule, Pencil, User } from 'lucide-angular';
import { houseColor } from '../../models/house-colors';
import type { PersonLike } from '../../models/person';
import type { FilterTier } from '../../models/projection';

/**
 * One person's card on the tree: parchment on the dark ground, edged in the
 * colour of their house.
 *
 * Purely presentational — it takes a `PersonLike`, which has no `gmNotes` member,
 * so the card cannot render GM prep even if asked to. GM-only affordances
 * (visibility, parentage, edit, dossier) are gated on `gmView` and are absent from
 * the DOM otherwise.
 */
@Component({
  selector: 'app-person-card',
  imports: [LucideAngularModule],
  templateUrl: './person-card.html',
  styleUrl: './person-card.scss',
  host: {
    '[class.is-adjacent]': "tier() === 'adjacent'",
    '[class.is-hidden-record]': "person().visibility === 'hidden'",
    '[class.is-selected]': 'selected()',
    '[class.is-highlighted]': 'highlighted()',
    '[class.is-dimmed]': 'dimmed()',
  },
})
export class PersonCard {
  readonly EyeIcon = Eye;
  readonly EyeOffIcon = EyeOff;
  readonly LockIcon = Lock;
  readonly LockOpenIcon = LockOpen;
  readonly PencilIcon = Pencil;
  readonly UserIcon = User;

  readonly person = input.required<PersonLike>();
  readonly tier = input<FilterTier>('core');
  /** When false, no GM affordance is rendered at all. */
  readonly gmView = input<boolean>(false);
  readonly selected = input<boolean>(false);
  readonly highlighted = input<boolean>(false);
  /** True when an event is selected and this person is not part of it. */
  readonly dimmed = input<boolean>(false);

  readonly select = output<string>();
  readonly editPerson = output<string>();
  readonly openDossier = output<string>();
  readonly toggleVisibility = output<string>();
  readonly toggleHideParentage = output<string>();

  readonly houseColor = computed<string>(() => houseColor(this.person().house));

  readonly isHiddenRecord = computed<boolean>(() => this.person().visibility === 'hidden');

  /** The parentage lock is meaningless for someone with no parents recorded. */
  readonly canHideParentage = computed<boolean>(() => this.person().parentIds.length > 0);

  /** "1170–1231", "b. 1201", or "" when no years are recorded. */
  readonly lifespan = computed<string>(() => {
    const { birthYear, deathYear } = this.person();
    if (birthYear !== undefined && deathYear !== undefined) return `${birthYear}–${deathYear}`;
    if (birthYear !== undefined) return `b. ${birthYear}`;
    if (deathYear !== undefined) return `d. ${deathYear}`;
    return '';
  });

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
