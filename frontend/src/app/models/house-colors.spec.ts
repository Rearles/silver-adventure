import { describe, expect, it } from 'vitest';
import { NO_HOUSE_COLOR, houseColor } from './house-colors';

describe('houseColor', () => {
  it('returns the neutral when no house is recorded', () => {
    expect(houseColor('')).toBe(NO_HOUSE_COLOR);
    expect(houseColor('   ')).toBe(NO_HOUSE_COLOR);
  });

  it('assigns any house a stable colour across calls', () => {
    // Houses are just strings on people — a new one must not need registering.
    const first = houseColor('Ashfell');
    const second = houseColor('Ashfell');

    expect(first).toBe(second);
    expect(first).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('ignores surrounding whitespace when hashing the house name', () => {
    expect(houseColor('  Ashfell  ')).toBe(houseColor('Ashfell'));
  });

  it('gives different house names different colours often enough to be useful', () => {
    // Not a guarantee (hashing can collide), but a ramp of 10 colours over a
    // handful of distinct house names should not collapse them all to one.
    const houses = ['Ashfell', 'Vail', 'Greymoor', 'Fenmark', 'Doryne', 'Marchand'];
    const colors = new Set(houses.map((house) => houseColor(house)));

    expect(colors.size).toBeGreaterThan(1);
  });

  it('never assigns an actual house name the neutral colour', () => {
    for (const house of ['Ashfell', 'Vail', 'Greymoor', 'Fenmark']) {
      expect(houseColor(house)).not.toBe(NO_HOUSE_COLOR);
    }
  });
});
