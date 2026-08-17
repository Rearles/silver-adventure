/**
 * Per-house accent colours.
 *
 * Houses are just strings on people — nothing in the app registers them — so
 * colours are assigned deterministically from a fixed ramp by hashing the house
 * name. The same house always gets the same colour within a session and across
 * reloads, without any setup: invent a house in the person form or a CSV import
 * and it immediately has a stable, on-palette colour.
 */
const HOUSE_COLOR_RAMP: readonly string[] = [
  '#a3435a',
  '#4a8577',
  '#7a5b8c',
  '#5c8c5c',
  '#3d6ea8',
  '#8c6a3f',
  '#8c5c5c',
  '#4a7a8c',
  '#7a7a3f',
  '#6a4a8c',
];

/** Neutral used when a person has no house recorded at all. */
export const NO_HOUSE_COLOR = '#8a8272';

function hash(value: string): number {
  let accumulator = 0;
  for (let index = 0; index < value.length; index += 1) {
    // Standard 31-multiplier string hash, kept in 32-bit range.
    accumulator = (accumulator * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(accumulator);
}

export function houseColor(house: string): string {
  const trimmed = house.trim();
  if (trimmed === '') return NO_HOUSE_COLOR;

  return HOUSE_COLOR_RAMP[hash(trimmed) % HOUSE_COLOR_RAMP.length];
}
