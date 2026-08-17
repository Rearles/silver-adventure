import { describe, expect, it } from 'vitest';
import { NO_HOUSE_COLOR, houseColor, namedHouses } from './house-colors';

describe('houseColor', () => {
  it('uses the reference palette for the named houses', () => {
    expect(houseColor('Valcrest')).toBe('#a3435a');
    expect(houseColor('Solenne')).toBe('#4a8577');
    expect(houseColor('Thornwood')).toBe('#7a5b8c');
    expect(houseColor('Ashgrove')).toBe('#5c8c5c');
    expect(houseColor('Draven')).toBe('#3d6ea8');
    expect(houseColor('Marrow')).toBe('#8c6a3f');
  });

  it('gives every named house a distinct colour', () => {
    const colors = namedHouses().map((house) => houseColor(house));

    expect(new Set(colors).size).toBe(colors.length);
  });

  it('returns the neutral when no house is recorded', () => {
    expect(houseColor('')).toBe(NO_HOUSE_COLOR);
    expect(houseColor('   ')).toBe(NO_HOUSE_COLOR);
  });

  it('assigns an unknown house a stable colour across calls', () => {
    // Houses are just strings on people — a new one must not need registering.
    const first = houseColor('Ashfell');
    const second = houseColor('Ashfell');

    expect(first).toBe(second);
    expect(first).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('ignores surrounding whitespace when matching a known house', () => {
    expect(houseColor('  Valcrest  ')).toBe(houseColor('Valcrest'));
  });

  it('does not collide unknown houses onto the neutral', () => {
    for (const house of ['Ashfell', 'Vail', 'Greymoor', 'Fenmark']) {
      expect(houseColor(house)).not.toBe(NO_HOUSE_COLOR);
    }
  });
});
