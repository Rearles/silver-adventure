import type { DynastyEvent } from './dynasty-event';
import type { Person } from './person';

/** Shape of `data/{world}.json`. */
export interface WorldPeopleFile {
  people: Person[];
}

/** Shape of `data/{world}-events.json`. */
export interface WorldEventsFile {
  events: DynastyEvent[];
}

/** Which slice of the flat pool the tree and timeline are currently showing. */
export interface WorldFilter {
  nation: string | null;
  house: string | null;
}

export const EMPTY_WORLD_FILTER: WorldFilter = { nation: null, house: null };

/** Inclusive year bounds for the timeline. `null` means unbounded. */
export interface YearRange {
  from: number | null;
  to: number | null;
}

export const UNBOUNDED_YEARS: YearRange = { from: null, to: null };
