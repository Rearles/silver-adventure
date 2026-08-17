import type { Visibility } from './person';

export type DynastyEventType =
  | 'birth'
  | 'death'
  | 'coronation'
  | 'wedding'
  | 'war'
  | 'battle'
  | 'treaty'
  | 'other';

export const DYNASTY_EVENT_TYPES: readonly DynastyEventType[] = [
  'birth',
  'death',
  'coronation',
  'wedding',
  'war',
  'battle',
  'treaty',
  'other',
] as const;

/**
 * A dated happening, cross-linked to people by id rather than nested under
 * them. Stored in its own collection (`data/{world}-events.json`).
 */
export interface DynastyEvent {
  id: string;
  title: string;
  type: DynastyEventType;
  year: number;
  era?: string;
  description?: string;
  relatedPersonIds: string[];
  nation?: string;
  house?: string;
  /**
   * Same meaning as on `Person`: a secret war or hidden coronation drops out
   * of Player Preview the same way a secret person does.
   */
  visibility: Visibility;
}
