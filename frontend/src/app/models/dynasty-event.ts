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
  /** Day-of-month and month are optional precision on top of `startYear`, mirroring `Person.birthYear/Month/Day`. */
  startDay?: number;
  startMonth?: number;
  startYear: number;
  /**
   * Optional end of a spanning event (a reign, a war, a siege). Day-of-month
   * and month are optional precision on top of `endYear`, mirroring
   * `Person.deathYear/Month/Day` — unlike `start*`, none of these three are
   * required, since most events are a single dated happening, not a span.
   */
  endDay?: number;
  endMonth?: number;
  endYear?: number;
  era?: string;
  description?: string;
  relatedPersonIds: string[];
  /**
   * Which nation/house timelines this event appears on. Manually curated —
   * independent of `relatedPersonIds` overlap (see `TimelineDataService.filteredEvents`)
   * so a GM can pin an event onto a timeline it wouldn't otherwise qualify for.
   */
  nations: string[];
  houses: string[];
  /**
   * Same meaning as on `Person`: a secret war or hidden coronation drops out
   * of Player Preview the same way a secret person does.
   */
  visibility: Visibility;
}
