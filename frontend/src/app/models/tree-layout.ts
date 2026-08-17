import type { PersonLike } from './person';
import type { FilteredPerson, FilterTier } from './projection';

/**
 * Pure geometry for the family tree.
 *
 * Kept free of Angular and of any charting library so it can be unit-tested and
 * reasoned about on its own. The renderer just draws what this returns.
 */

/**
 * Card metrics follow the reference prototype's proportions, widened from its
 * 168px because this app puts four GM controls on a card where the prototype had
 * two — at 168px names like "Yseult Thornwood" truncated.
 */
export const CARD_WIDTH = 196;
/** Tall enough for name, title, house row, and one GM-only note line. */
export const CARD_HEIGHT = 96;
/** Gap between two spouses inside one marriage cluster. */
export const SPOUSE_GAP = 18;
/** Gap between neighbouring clusters in the same generation. */
export const UNIT_GAP = 44;
export const ROW_HEIGHT = 172;
export const PADDING = 40;

export interface TreeNode<T extends PersonLike> {
  person: T;
  tier: FilterTier;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TreeLink {
  id: string;
  kind: 'spouse' | 'parent';
  path: string;
  /**
   * True when the link exists in the data but the child is flagged
   * `hideParentage` — drawn dashed in GM View to mark rumoured parentage.
   * Player projections strip these edges before layout, so they never appear.
   */
  rumoured: boolean;
}

export interface GenerationRow {
  generation: number;
  y: number;
}

export interface TreeLayout<T extends PersonLike> {
  nodes: TreeNode<T>[];
  links: TreeLink[];
  generations: GenerationRow[];
  width: number;
  height: number;
}

/** A single person or a married cluster, laid out as one indivisible block. */
interface Unit<T extends PersonLike> {
  members: FilteredPerson<T>[];
  width: number;
  x: number;
}

function unitWidth(memberCount: number): number {
  return memberCount * CARD_WIDTH + (memberCount - 1) * SPOUSE_GAP;
}

/**
 * Groups a generation's people into marriage clusters.
 *
 * Only spouses in the *same* generation cluster together; a cross-generation
 * marriage stays two separate units so the rows do not distort.
 */
function buildUnits<T extends PersonLike>(
  row: FilteredPerson<T>[],
  byId: Map<string, FilteredPerson<T>>,
): Unit<T>[] {
  const claimed = new Set<string>();
  const units: Unit<T>[] = [];

  // Sort so cluster seeds are deterministic: succession order first, then name.
  const seeds = [...row].sort(compareForDisplay);

  for (const entry of seeds) {
    if (claimed.has(entry.person.id)) continue;
    claimed.add(entry.person.id);

    const members: FilteredPerson<T>[] = [entry];
    for (const spouseId of entry.person.spouseIds) {
      if (claimed.has(spouseId)) continue;
      const spouse = byId.get(spouseId);
      if (spouse === undefined) continue;
      if (spouse.person.generation !== entry.person.generation) continue;
      claimed.add(spouseId);
      members.push(spouse);
    }

    units.push({ members, width: unitWidth(members.length), x: 0 });
  }

  return units;
}

function compareForDisplay<T extends PersonLike>(
  a: FilteredPerson<T>,
  b: FilteredPerson<T>,
): number {
  const aOrder = a.person.successionOrder ?? Number.MAX_SAFE_INTEGER;
  const bOrder = b.person.successionOrder ?? Number.MAX_SAFE_INTEGER;
  if (aOrder !== bOrder) return aOrder - bOrder;
  return a.person.name.localeCompare(b.person.name);
}

/**
 * Lays out the filtered pool into rows by `generation`.
 *
 * Rows are placed in ascending generation order. Within a row, each cluster is
 * pulled toward the midpoint of its parents and then pushed right just enough to
 * clear its left neighbour — one pass that both orders and aligns the row, which
 * keeps parent-child lines close to vertical without a full Reingold–Tilford
 * implementation.
 */
export function layoutTree<T extends PersonLike>(
  filtered: readonly FilteredPerson<T>[],
): TreeLayout<T> {
  if (filtered.length === 0) {
    return { nodes: [], links: [], generations: [], width: 0, height: 0 };
  }

  const byId = new Map(filtered.map((entry) => [entry.person.id, entry]));
  const generations = [...new Set(filtered.map((e) => e.person.generation))].sort(
    (a, b) => a - b,
  );

  const rowY = new Map<number, number>();
  generations.forEach((generation, index) => {
    rowY.set(generation, PADDING + index * ROW_HEIGHT);
  });

  // Where each person's card ends up, filled in row by row.
  const placement = new Map<string, { x: number; y: number }>();
  const unitsByGeneration = new Map<number, Unit<T>[]>();

  for (const generation of generations) {
    const row = filtered.filter((entry) => entry.person.generation === generation);
    const units = buildUnits(row, byId);

    // Desired x = centred under the midpoint of whatever parents are placed.
    const desired = new Map<Unit<T>, number>();
    for (const unit of units) {
      const parentCentres: number[] = [];
      for (const member of unit.members) {
        if (member.person.hideParentage) continue;
        for (const parentId of member.person.parentIds) {
          const parentPlacement = placement.get(parentId);
          if (parentPlacement !== undefined) {
            parentCentres.push(parentPlacement.x + CARD_WIDTH / 2);
          }
        }
      }
      if (parentCentres.length > 0) {
        const mean =
          parentCentres.reduce((sum, value) => sum + value, 0) / parentCentres.length;
        desired.set(unit, mean - unit.width / 2);
      }
    }

    units.sort((a, b) => {
      const aDesired = desired.get(a);
      const bDesired = desired.get(b);
      // Units with placed parents anchor the row; parentless units trail.
      if (aDesired !== undefined && bDesired !== undefined) return aDesired - bDesired;
      if (aDesired !== undefined) return -1;
      if (bDesired !== undefined) return 1;
      return compareForDisplay(a.members[0], b.members[0]);
    });

    let cursor = PADDING;
    for (const unit of units) {
      unit.x = Math.max(desired.get(unit) ?? cursor, cursor);
      cursor = unit.x + unit.width + UNIT_GAP;

      const y = rowY.get(generation) ?? PADDING;
      unit.members.forEach((member, index) => {
        placement.set(member.person.id, {
          x: unit.x + index * (CARD_WIDTH + SPOUSE_GAP),
          y,
        });
      });
    }

    unitsByGeneration.set(generation, units);
  }

  // ── Nodes ────────────────────────────────────────────────────────────────
  const nodes: TreeNode<T>[] = filtered.map((entry) => {
    const spot = placement.get(entry.person.id) ?? { x: PADDING, y: PADDING };
    return {
      person: entry.person,
      tier: entry.tier,
      x: spot.x,
      y: spot.y,
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
    };
  });

  // ── Links ────────────────────────────────────────────────────────────────
  const links: TreeLink[] = [];

  // Spouse bars: horizontal connector between adjacent partners in a cluster.
  for (const units of unitsByGeneration.values()) {
    for (const unit of units) {
      for (let i = 0; i < unit.members.length - 1; i += 1) {
        const left = unit.members[i];
        const right = unit.members[i + 1];
        const y = (placement.get(left.person.id)?.y ?? 0) + CARD_HEIGHT / 2;
        const startX = unit.x + i * (CARD_WIDTH + SPOUSE_GAP) + CARD_WIDTH;
        links.push({
          id: `spouse:${left.person.id}:${right.person.id}`,
          kind: 'spouse',
          path: `M ${startX} ${y} L ${startX + SPOUSE_GAP} ${y}`,
          rumoured: false,
        });
      }
    }
  }

  // Parent links: one elbow per child, dropping from the parents' midpoint to a
  // bus line in the gutter, across, then down into the top of the child card.
  for (const entry of filtered) {
    const child = entry.person;
    if (child.parentIds.length === 0) continue;

    const parentSpots = child.parentIds
      .map((parentId) => placement.get(parentId))
      .filter((spot): spot is { x: number; y: number } => spot !== undefined);
    if (parentSpots.length === 0) continue;

    const childSpot = placement.get(child.id);
    if (childSpot === undefined) continue;

    const anchorX =
      parentSpots.reduce((sum, spot) => sum + spot.x + CARD_WIDTH / 2, 0) /
      parentSpots.length;
    const anchorY = Math.max(...parentSpots.map((spot) => spot.y)) + CARD_HEIGHT;
    const busY = anchorY + (ROW_HEIGHT - CARD_HEIGHT) / 2;
    const childX = childSpot.x + CARD_WIDTH / 2;

    links.push({
      id: `parent:${child.id}`,
      kind: 'parent',
      path: `M ${anchorX} ${anchorY} L ${anchorX} ${busY} L ${childX} ${busY} L ${childX} ${childSpot.y}`,
      rumoured: child.hideParentage,
    });
  }

  const width =
    Math.max(...nodes.map((node) => node.x + node.width), PADDING) + PADDING;
  const height =
    Math.max(...nodes.map((node) => node.y + node.height), PADDING) + PADDING;

  return {
    nodes,
    links,
    generations: generations.map((generation) => ({
      generation,
      y: rowY.get(generation) ?? PADDING,
    })),
    width,
    height,
  };
}
