import type { DynastyEvent } from './dynasty-event';
import type { Person, PersonLike, PlayerPerson } from './person';
import type { WorldFilter } from './world';

/**
 * Pure projection + filtering logic, deliberately free of Angular DI so it can
 * be unit-tested directly. The player projections here are the only sanctioned
 * way to build player-facing data.
 */

/** Drops `gmNotes` by structural omission rather than blanking it. */
function stripGmNotes(person: Person): PlayerPerson {
  const { gmNotes, ...playerFacing } = person;
  void gmNotes;
  return playerFacing;
}

/**
 * Projects the GM's full people pool down to what players may see.
 *
 * Three things happen, in order:
 *  1. `visibility: 'hidden'` people are removed outright.
 *  2. `gmNotes` is stripped from every survivor — unconditionally, including
 *     from fully `known` people.
 *  3. Relationship ids are re-pointed at survivors only. A person with
 *     `hideParentage` loses `parentIds` entirely, and any id referring to a
 *     hidden person is dropped — otherwise a dangling id in the player payload
 *     would betray that a secret relative exists.
 *  4. `hideParentage` is cleared once it has been applied. In the players' view
 *     the person simply has no recorded parents; leaving the flag set would tell
 *     them precisely whose parentage is being concealed, which is the very thing
 *     the flag exists to hide.
 */
export function toPlayerPeople(people: readonly Person[]): PlayerPerson[] {
  const visible = people.filter((person) => person.visibility === 'known');
  const visibleIds = new Set(visible.map((person) => person.id));

  return visible.map((person) => {
    const playerFacing = stripGmNotes(person);
    return {
      ...playerFacing,
      parentIds: person.hideParentage
        ? []
        : person.parentIds.filter((id) => visibleIds.has(id)),
      spouseIds: person.spouseIds.filter((id) => visibleIds.has(id)),
      hideParentage: false,
    };
  });
}

/**
 * Projects events down to what players may see: hidden events are removed, and
 * `relatedPersonIds` is narrowed to people who survive the people projection —
 * so a public wedding cannot reveal a secret participant.
 */
export function toPlayerEvents(
  events: readonly DynastyEvent[],
  people: readonly Person[],
): DynastyEvent[] {
  const visiblePersonIds = new Set(
    people.filter((person) => person.visibility === 'known').map((person) => person.id),
  );

  return events
    .filter((event) => event.visibility === 'known')
    .map((event) => ({
      ...event,
      relatedPersonIds: event.relatedPersonIds.filter((id) => visiblePersonIds.has(id)),
    }));
}

/**
 * `core` people match the active filter outright; `adjacent` people are pulled
 * in only because they marry or parent someone in the core set, and are
 * rendered visually secondary.
 */
export type FilterTier = 'core' | 'adjacent';

export interface FilteredPerson<T> {
  person: T;
  tier: FilterTier;
}

/**
 * Union match: a person qualifies if their nation is one of `filter.nations`
 * *or* their house is one of `filter.houses` — not both. Selecting several
 * nations/houses together is how "combine timelines" works (see `WorldFilter`).
 * Only called once at least one of the two arrays is non-empty (`applyOverlapFilter`
 * short-circuits the fully-unfiltered case before reaching here).
 */
function matchesFilter(person: PersonLike, filter: WorldFilter): boolean {
  return filter.nations.includes(person.nation) || filter.houses.includes(person.house);
}

/**
 * Filters the flat pool to a house/nation **without severing its edges**.
 *
 * Everyone matching the filter is `core`. Anyone directly connected to a core
 * person — spouse, parent, or child — is also returned, tagged `adjacent`, even
 * though they fail the filter themselves. This is the point of keeping one flat
 * pool: a strict filter would hide the in-marrying spouse from another house,
 * which is exactly the relationship a royal family chart exists to show.
 */
export function applyOverlapFilter<T extends PersonLike>(
  people: readonly T[],
  filter: WorldFilter,
): FilteredPerson<T>[] {
  if (filter.nations.length === 0 && filter.houses.length === 0) {
    return people.map((person) => ({ person, tier: 'core' as const }));
  }

  const coreIds = new Set(
    people.filter((person) => matchesFilter(person, filter)).map((person) => person.id),
  );

  const adjacentIds = new Set<string>();
  const include = (id: string): void => {
    if (!coreIds.has(id)) adjacentIds.add(id);
  };

  for (const person of people) {
    if (coreIds.has(person.id)) {
      // Reach outward from the core: partners and parents.
      for (const spouseId of person.spouseIds) include(spouseId);
      for (const parentId of person.parentIds) include(parentId);
    } else {
      // Reach inward: a non-core person parenting a core person is adjacent.
      if (person.parentIds.some((parentId) => coreIds.has(parentId))) {
        adjacentIds.add(person.id);
      }
      // A non-core person married to a core person is adjacent.
      if (person.spouseIds.some((spouseId) => coreIds.has(spouseId))) {
        adjacentIds.add(person.id);
      }
    }
  }

  const result: FilteredPerson<T>[] = [];
  for (const person of people) {
    if (coreIds.has(person.id)) {
      result.push({ person, tier: 'core' });
    } else if (adjacentIds.has(person.id)) {
      result.push({ person, tier: 'adjacent' });
    }
  }
  return result;
}

/** Distinct nation names present in the pool, sorted. */
export function collectNations(people: readonly PersonLike[]): string[] {
  return [...new Set(people.map((person) => person.nation))].filter(Boolean).sort();
}

/**
 * Distinct house names, optionally narrowed to one nation. Houses are listed
 * for the nation currently in focus so the picker stays short.
 */
export function collectHouses(
  people: readonly PersonLike[],
  nation: string | null,
): string[] {
  const scoped = nation === null ? people : people.filter((p) => p.nation === nation);
  return [...new Set(scoped.map((person) => person.house))].filter(Boolean).sort();
}
