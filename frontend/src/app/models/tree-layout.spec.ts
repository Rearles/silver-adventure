import { describe, expect, it } from 'vitest';
import type { Person } from './person';
import { applyOverlapFilter, toPlayerPeople } from './projection';
import type { FilteredPerson } from './projection';
import { CARD_HEIGHT, CARD_WIDTH, ROW_HEIGHT, layoutTree } from './tree-layout';

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

/** Lays out a pool with no filter applied — everything core. */
function layoutAll(people: Person[]) {
  const filtered: FilteredPerson<Person>[] = people.map((p) => ({ person: p, tier: 'core' }));
  return layoutTree(filtered);
}

describe('layoutTree', () => {
  it('returns an empty layout for an empty pool', () => {
    const layout = layoutTree([]);

    expect(layout.nodes).toEqual([]);
    expect(layout.links).toEqual([]);
    expect(layout.width).toBe(0);
    expect(layout.height).toBe(0);
  });

  it('places one row per distinct generation, in ascending order', () => {
    const layout = layoutAll([
      person({ id: 'g2', generation: 2 }),
      person({ id: 'g0', generation: 0 }),
      person({ id: 'g1', generation: 1 }),
    ]);

    expect(layout.generations.map((row) => row.generation)).toEqual([0, 1, 2]);
    const ys = new Map(layout.generations.map((row) => [row.generation, row.y]));
    expect((ys.get(1) ?? 0) - (ys.get(0) ?? 0)).toBe(ROW_HEIGHT);
  });

  it('handles non-contiguous generation numbers without leaving empty rows', () => {
    const layout = layoutAll([
      person({ id: 'a', generation: 0 }),
      person({ id: 'b', generation: 7 }),
    ]);

    expect(layout.generations).toHaveLength(2);
    const ys = layout.generations.map((row) => row.y);
    expect(ys[1] - ys[0]).toBe(ROW_HEIGHT);
  });

  it('gives every person a node sized to the card constants', () => {
    const layout = layoutAll([person({ id: 'a' }), person({ id: 'b' })]);

    expect(layout.nodes).toHaveLength(2);
    for (const node of layout.nodes) {
      expect(node.width).toBe(CARD_WIDTH);
      expect(node.height).toBe(CARD_HEIGHT);
    }
  });

  it('clusters same-generation spouses side by side with a spouse link', () => {
    const layout = layoutAll([
      person({ id: 'king', spouseIds: ['queen'] }),
      person({ id: 'queen', spouseIds: ['king'] }),
    ]);

    const spouseLinks = layout.links.filter((link) => link.kind === 'spouse');
    expect(spouseLinks).toHaveLength(1);
    expect(spouseLinks[0].rumoured).toBe(false);

    const nodes = new Map(layout.nodes.map((node) => [node.person.id, node]));
    // Same row, adjacent columns.
    expect(nodes.get('king')?.y).toBe(nodes.get('queen')?.y);
    expect(Math.abs((nodes.get('king')?.x ?? 0) - (nodes.get('queen')?.x ?? 0))).toBeGreaterThan(
      0,
    );
  });

  it('does not cluster spouses who sit in different generations', () => {
    const layout = layoutAll([
      person({ id: 'elder', generation: 0, spouseIds: ['younger'] }),
      person({ id: 'younger', generation: 1, spouseIds: ['elder'] }),
    ]);

    expect(layout.links.filter((link) => link.kind === 'spouse')).toHaveLength(0);
  });

  it('supports two marriages for one person', () => {
    const layout = layoutAll([
      person({ id: 'king', spouseIds: ['wife1', 'wife2'] }),
      person({ id: 'wife1', spouseIds: ['king'] }),
      person({ id: 'wife2', spouseIds: ['king'] }),
    ]);

    // One cluster of three ⇒ two adjacent spouse bars.
    expect(layout.links.filter((link) => link.kind === 'spouse')).toHaveLength(2);
    const row = new Set(layout.nodes.map((node) => node.y));
    expect(row.size).toBe(1);
  });

  it('draws a parent link from parents down to each child', () => {
    const layout = layoutAll([
      person({ id: 'king', spouseIds: ['queen'] }),
      person({ id: 'queen', spouseIds: ['king'] }),
      person({ id: 'heir', parentIds: ['king', 'queen'], generation: 1 }),
    ]);

    const parentLinks = layout.links.filter((link) => link.kind === 'parent');
    expect(parentLinks).toHaveLength(1);
    expect(parentLinks[0].id).toBe('parent:heir');
    expect(parentLinks[0].rumoured).toBe(false);
    expect(parentLinks[0].path.startsWith('M ')).toBe(true);
  });

  it('marks a hideParentage child’s link rumoured so GM View can dash it', () => {
    const layout = layoutAll([
      person({ id: 'king' }),
      person({ id: 'bastard', parentIds: ['king'], hideParentage: true, generation: 1 }),
    ]);

    const parentLinks = layout.links.filter((link) => link.kind === 'parent');
    expect(parentLinks).toHaveLength(1);
    expect(parentLinks[0].rumoured).toBe(true);
  });

  it('draws no parent link at all once the player projection has stripped the edge', () => {
    const projected = toPlayerPeople([
      person({ id: 'king' }),
      person({ id: 'bastard', parentIds: ['king'], hideParentage: true, generation: 1 }),
    ]);
    const layout = layoutTree(projected.map((p) => ({ person: p, tier: 'core' as const })));

    expect(layout.links.filter((link) => link.kind === 'parent')).toHaveLength(0);
    // The person is still on the chart — they just lose the line upward.
    expect(layout.nodes.map((node) => node.person.id)).toContain('bastard');
  });

  it('omits a parent link when the parent is not in the rendered set', () => {
    // Filtering to one house can leave a child whose parent was excluded.
    const layout = layoutAll([person({ id: 'orphan', parentIds: ['missing'], generation: 1 })]);

    expect(layout.links.filter((link) => link.kind === 'parent')).toHaveLength(0);
    expect(layout.nodes).toHaveLength(1);
  });

  it('never overlaps two cards in the same row', () => {
    const layout = layoutAll([
      person({ id: 'a' }),
      person({ id: 'b' }),
      person({ id: 'c' }),
      person({ id: 'd' }),
    ]);

    const sorted = [...layout.nodes].sort((l, r) => l.x - r.x);
    for (let i = 0; i < sorted.length - 1; i += 1) {
      expect(sorted[i].x + sorted[i].width).toBeLessThanOrEqual(sorted[i + 1].x);
    }
  });

  it('keeps children roughly centred beneath their parents', () => {
    const layout = layoutAll([
      person({ id: 'king', spouseIds: ['queen'] }),
      person({ id: 'queen', spouseIds: ['king'] }),
      person({ id: 'heir', parentIds: ['king', 'queen'], generation: 1 }),
    ]);

    const nodes = new Map(layout.nodes.map((node) => [node.person.id, node]));
    const parentMidpoint =
      (((nodes.get('king')?.x ?? 0) + (nodes.get('queen')?.x ?? 0)) / 2) + CARD_WIDTH / 2;
    const childCentre = (nodes.get('heir')?.x ?? 0) + CARD_WIDTH / 2;

    expect(Math.abs(childCentre - parentMidpoint)).toBeLessThan(1);
  });

  it('carries the filter tier through onto the nodes', () => {
    const pool = [
      person({ id: 'king', house: 'Valcrest' }),
      person({ id: 'consort', house: 'Doryne', spouseIds: ['king'] }),
    ];
    const layout = layoutTree(applyOverlapFilter(pool, { nation: null, house: 'Valcrest' }));
    const tiers = new Map(layout.nodes.map((node) => [node.person.id, node.tier]));

    expect(tiers.get('king')).toBe('core');
    expect(tiers.get('consort')).toBe('adjacent');
  });

  it('reports a canvas large enough to contain every node', () => {
    const layout = layoutAll([
      person({ id: 'a' }),
      person({ id: 'b', generation: 1 }),
      person({ id: 'c', generation: 2 }),
    ]);

    for (const node of layout.nodes) {
      expect(node.x + node.width).toBeLessThanOrEqual(layout.width);
      expect(node.y + node.height).toBeLessThanOrEqual(layout.height);
    }
  });
});
