/**
 * Whether an entity exists at all in the player-facing view.
 * `hidden` entities are absent from the player projection entirely.
 */
export type Visibility = 'known' | 'hidden';

/**
 * GM-only character prep.
 *
 * Never included in any player-facing projection under any circumstances.
 * This is independent of `visibility` / `hideParentage`: even a fully `known`
 * person's `gmNotes` stay GM-only.
 */
export interface GmNotes {
  personalityTraits?: string[];
  physicalDescription?: string;
  /** Free text or other person ids. */
  allies?: string[];
  /** Free text or other person ids. */
  enemies?: string[];
  motivations?: string;
  goals?: string;
  ambitions?: string;
  /** The GM's own prep notes on plot secrets, distinct from `visibility`. */
  secrets?: string;
}

export interface Person {
  id: string;
  name: string;
  house: string;
  nation: string;
  title?: string;
  birthYear?: number;
  deathYear?: number;
  isAlive: boolean;
  /** 0–2 entries. */
  parentIds: string[];
  /** Supports multiple marriages. */
  spouseIds: string[];
  successionOrder?: number;
  notes?: string;
  tags?: string[];
  generation: number;
  visibility: Visibility;
  /**
   * If true, this person is visible to players but their `parentIds` are not
   * (secret/rumoured parentage plots).
   */
  hideParentage: boolean;
  gmNotes?: GmNotes;
}

/**
 * A person as seen by players.
 *
 * `gmNotes` is structurally absent rather than merely blanked, so handing a
 * `PlayerPerson` to a player-facing surface cannot leak GM prep even by
 * accident — the property does not exist on the type.
 */
export type PlayerPerson = Omit<Person, 'gmNotes'>;

/**
 * The minimum shape the tree layout, overlap filter, and person card need.
 *
 * Both `Person` and `PlayerPerson` satisfy this, so every rendering path can be
 * generic over it and stays correct in either view mode.
 */
export interface PersonLike {
  id: string;
  name: string;
  house: string;
  nation: string;
  title?: string;
  birthYear?: number;
  deathYear?: number;
  isAlive: boolean;
  parentIds: string[];
  spouseIds: string[];
  successionOrder?: number;
  generation: number;
  visibility: Visibility;
  hideParentage: boolean;
}
