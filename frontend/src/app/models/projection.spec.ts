import { describe, expect, it } from 'vitest';
import type { DynastyEvent } from './dynasty-event';
import type { Person } from './person';
import {
  applyOverlapFilter,
  collectHouses,
  collectNations,
  toPlayerEvents,
  toPlayerPeople,
} from './projection';

function person(overrides: Partial<Person> & Pick<Person, 'id'>): Person {
  return {
    name: overrides.id,
    house: 'Valcrest',
    nation: 'Astyria',
    isAlive: true,
    parentIds: [],
    spouseIds: [],
    generation: 0,
    visibility: 'known',
    hideParentage: false,
    ...overrides,
  };
}

function event(overrides: Partial<DynastyEvent> & Pick<DynastyEvent, 'id'>): DynastyEvent {
  return {
    title: overrides.id,
    type: 'other',
    startYear: 1400,
    relatedPersonIds: [],
    nations: [],
    houses: [],
    visibility: 'known',
    ...overrides,
  };
}

describe('toPlayerPeople', () => {
  it('removes people whose visibility is hidden', () => {
    const projected = toPlayerPeople([
      person({ id: 'p1' }),
      person({ id: 'p2', visibility: 'hidden' }),
    ]);

    expect(projected.map((p) => p.id)).toEqual(['p1']);
  });

  it('strips gmNotes from every survivor, including fully known people', () => {
    const projected = toPlayerPeople([
      person({
        id: 'p1',
        visibility: 'known',
        hideParentage: false,
        gmNotes: { secrets: 'the king is not the father' },
      }),
    ]);

    expect(projected).toHaveLength(1);
    // Structural absence, not a blanked value.
    expect('gmNotes' in projected[0]).toBe(false);
  });

  it('never leaks any gmNotes content into the serialised player payload', () => {
    const projected = toPlayerPeople([
      person({
        id: 'p1',
        gmNotes: {
          personalityTraits: ['UNIQUE_TRAIT_TOKEN'],
          physicalDescription: 'UNIQUE_DESC_TOKEN',
          allies: ['UNIQUE_ALLY_TOKEN'],
          enemies: ['UNIQUE_ENEMY_TOKEN'],
          motivations: 'UNIQUE_MOTIVE_TOKEN',
          goals: 'UNIQUE_GOAL_TOKEN',
          ambitions: 'UNIQUE_AMBITION_TOKEN',
          secrets: 'UNIQUE_SECRET_TOKEN',
        },
      }),
    ]);

    const serialised = JSON.stringify(projected);
    for (const token of [
      'UNIQUE_TRAIT_TOKEN',
      'UNIQUE_DESC_TOKEN',
      'UNIQUE_ALLY_TOKEN',
      'UNIQUE_ENEMY_TOKEN',
      'UNIQUE_MOTIVE_TOKEN',
      'UNIQUE_GOAL_TOKEN',
      'UNIQUE_AMBITION_TOKEN',
      'UNIQUE_SECRET_TOKEN',
    ]) {
      expect(serialised).not.toContain(token);
    }
  });

  it('empties parentIds for people flagged hideParentage but keeps the person', () => {
    const projected = toPlayerPeople([
      person({ id: 'parent' }),
      person({ id: 'child', parentIds: ['parent'], hideParentage: true, generation: 1 }),
    ]);

    const child = projected.find((p) => p.id === 'child');
    expect(child).toBeDefined();
    expect(child?.parentIds).toEqual([]);
  });

  it('clears the hideParentage flag once applied, so the payload names no concealment', () => {
    const projected = toPlayerPeople([
      person({ id: 'parent' }),
      person({ id: 'child', parentIds: ['parent'], hideParentage: true, generation: 1 }),
      person({ id: 'ordinary', parentIds: ['parent'], generation: 1 }),
    ]);

    // Nothing in the player payload distinguishes the concealed child from a
    // person who genuinely has no recorded parents.
    for (const projectedPerson of projected) {
      expect(projectedPerson.hideParentage).toBe(false);
    }
    const child = projected.find((p) => p.id === 'child');
    expect(child?.parentIds).toEqual([]);
  });

  it('drops parent ids that point at hidden people, so no dangling id betrays them', () => {
    const projected = toPlayerPeople([
      person({ id: 'secretParent', visibility: 'hidden' }),
      person({ id: 'knownParent' }),
      person({ id: 'child', parentIds: ['secretParent', 'knownParent'], generation: 1 }),
    ]);

    const child = projected.find((p) => p.id === 'child');
    expect(child?.parentIds).toEqual(['knownParent']);
    expect(JSON.stringify(projected)).not.toContain('secretParent');
  });

  it('drops spouse ids that point at hidden people', () => {
    const projected = toPlayerPeople([
      person({ id: 'p1', spouseIds: ['secretSpouse'] }),
      person({ id: 'secretSpouse', visibility: 'hidden', spouseIds: ['p1'] }),
    ]);

    expect(projected).toHaveLength(1);
    expect(projected[0].spouseIds).toEqual([]);
  });

  it('leaves an ordinary known person otherwise untouched', () => {
    const projected = toPlayerPeople([
      person({ id: 'p1', title: 'Queen', birthYear: 1455, successionOrder: 1 }),
    ]);

    expect(projected[0]).toMatchObject({
      id: 'p1',
      title: 'Queen',
      birthYear: 1455,
      successionOrder: 1,
    });
  });
});

describe('toPlayerEvents', () => {
  it('removes hidden events', () => {
    const projected = toPlayerEvents(
      [event({ id: 'e1' }), event({ id: 'e2', visibility: 'hidden' })],
      [],
    );

    expect(projected.map((e) => e.id)).toEqual(['e1']);
  });

  it('scrubs hidden people out of relatedPersonIds on a visible event', () => {
    const projected = toPlayerEvents(
      [event({ id: 'e1', relatedPersonIds: ['p1', 'secret'] })],
      [person({ id: 'p1' }), person({ id: 'secret', visibility: 'hidden' })],
    );

    expect(projected[0].relatedPersonIds).toEqual(['p1']);
    expect(JSON.stringify(projected)).not.toContain('secret');
  });
});

describe('applyOverlapFilter', () => {
  const pool = [
    person({ id: 'king', house: 'Valcrest' }),
    // In-married spouse from another house and nation.
    person({ id: 'consort', house: 'Doryne', nation: 'Meruvia', spouseIds: ['king'] }),
    person({ id: 'heir', house: 'Valcrest', parentIds: ['king', 'consort'], generation: 1 }),
    // Entirely unconnected to Valcrest.
    person({ id: 'stranger', house: 'Ashfell', nation: 'Astyria' }),
  ];

  it('treats everyone as core when no filter is set', () => {
    const filtered = applyOverlapFilter(pool, { nations: [], houses: [] });

    expect(filtered).toHaveLength(4);
    expect(filtered.every((entry) => entry.tier === 'core')).toBe(true);
  });

  it('pulls in an in-married spouse from another house as adjacent, not excluded', () => {
    const filtered = applyOverlapFilter(pool, { nations: [], houses: ['Valcrest'] });
    const tiers = new Map(filtered.map((entry) => [entry.person.id, entry.tier]));

    expect(tiers.get('king')).toBe('core');
    expect(tiers.get('heir')).toBe('core');
    // The whole point of the overlap rule.
    expect(tiers.get('consort')).toBe('adjacent');
  });

  it('excludes people with no connection to the filtered set', () => {
    const filtered = applyOverlapFilter(pool, { nations: [], houses: ['Valcrest'] });

    expect(filtered.map((entry) => entry.person.id)).not.toContain('stranger');
  });

  it('pulls in a non-core child of a core person as adjacent', () => {
    const filtered = applyOverlapFilter(
      [
        person({ id: 'core', house: 'Valcrest' }),
        person({ id: 'outsiderChild', house: 'Ashfell', parentIds: ['core'], generation: 1 }),
      ],
      { nations: [], houses: ['Valcrest'] },
    );
    const tiers = new Map(filtered.map((entry) => [entry.person.id, entry.tier]));

    expect(tiers.get('outsiderChild')).toBe('adjacent');
  });

  it('applies nation and house together', () => {
    const filtered = applyOverlapFilter(pool, { nations: ['Meruvia'], houses: ['Doryne'] });
    const tiers = new Map(filtered.map((entry) => [entry.person.id, entry.tier]));

    expect(tiers.get('consort')).toBe('core');
    // Reached through the marriage and the child link respectively.
    expect(tiers.get('king')).toBe('adjacent');
    expect(tiers.get('heir')).toBe('adjacent');
  });

  it('combines nations and houses as a union — matching either is enough, not both', () => {
    // Two people connected to nothing else, each qualifying on a different
    // dimension: this is the exact shape the old AND-semantics could never
    // produce as core (neither matches BOTH the selected nation and house).
    const combined = [
      person({ id: 'ashaNoble', nation: 'Asha', house: 'Unrelated' }),
      person({ id: 'sparrowCommoner', nation: 'Elsewhere', house: 'Sparrow' }),
      person({ id: 'outsider', nation: 'Elsewhere', house: 'Unrelated' }),
    ];

    const filtered = applyOverlapFilter(combined, { nations: ['Asha'], houses: ['Sparrow'] });
    const tiers = new Map(filtered.map((entry) => [entry.person.id, entry.tier]));

    expect(tiers.get('ashaNoble')).toBe('core');
    expect(tiers.get('sparrowCommoner')).toBe('core');
    expect(tiers.has('outsider')).toBe(false);
  });

  it('does not reach through a parent edge the player projection has removed', () => {
    // hideParentage is applied before filtering, so the edge is simply gone.
    const projected = toPlayerPeople([
      person({ id: 'king', house: 'Valcrest' }),
      person({
        id: 'secretChild',
        house: 'Ashfell',
        parentIds: ['king'],
        hideParentage: true,
        generation: 1,
      }),
    ]);
    const filtered = applyOverlapFilter(projected, { nations: [], houses: ['Valcrest'] });

    expect(filtered.map((entry) => entry.person.id)).toEqual(['king']);
  });
});

describe('collectNations / collectHouses', () => {
  const pool = [
    person({ id: 'a', nation: 'Astyria', house: 'Valcrest' }),
    person({ id: 'b', nation: 'Astyria', house: 'Ashfell' }),
    person({ id: 'c', nation: 'Meruvia', house: 'Doryne' }),
  ];

  it('lists distinct sorted nations', () => {
    expect(collectNations(pool)).toEqual(['Astyria', 'Meruvia']);
  });

  it('scopes houses to the given nation', () => {
    expect(collectHouses(pool, 'Astyria')).toEqual(['Ashfell', 'Valcrest']);
    expect(collectHouses(pool, null)).toEqual(['Ashfell', 'Doryne', 'Valcrest']);
  });
});
