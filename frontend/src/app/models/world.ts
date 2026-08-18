import type { DynastyEvent } from './dynasty-event';
import type { LoreDoc } from './lore-doc';
import type { Person } from './person';

/** Shape of `data/{world}.json`. */
export interface WorldPeopleFile {
  people: Person[];
}

/** Shape of `data/{world}-events.json`. */
export interface WorldEventsFile {
  events: DynastyEvent[];
}

/** Shape of `data/{world}-lore.json`. */
export interface WorldLoreFile {
  lore: LoreDoc[];
}

/**
 * Which slice of the flat pool the tree and timeline are currently showing.
 *
 * Multi-select with **union** semantics: a person/event matches if their
 * nation is in `nations` *or* their house is in `houses` (empty arrays mean
 * unfiltered — see `matchesFilter` in projection.ts). This is what lets a GM
 * view "Nation Asha" and "House Milltree" together as one combined timeline.
 */
export interface WorldFilter {
  nations: string[];
  houses: string[];
}

export const EMPTY_WORLD_FILTER: WorldFilter = { nations: [], houses: [] };

/** Inclusive year bounds for the timeline. `null` means unbounded. */
export interface YearRange {
  from: number | null;
  to: number | null;
}

export const UNBOUNDED_YEARS: YearRange = { from: null, to: null };
