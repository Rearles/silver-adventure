/**
 * Per-house accent colours.
 *
 * The named houses use the exact palette from the reference prototype. Any house
 * the GM invents later falls back to a deterministic hash into the same family of
 * hues, so a new house gets a stable, on-palette colour without anyone having to
 * register it — houses are just strings on people, and nothing in the app keeps a
 * registry of them.
 */
const KNOWN_HOUSE_COLORS: Readonly<Record<string, string>> = {
  Valcrest: '#a3435a',
  Solenne: '#4a8577',
  Thornwood: '#7a5b8c',
  Ashgrove: '#5c8c5c',
  Draven: '#3d6ea8',
  Marrow: '#8c6a3f',
};

/** Fallback ramp, drawn from the same muted heraldic range as the named houses. */
const FALLBACK_HOUSE_COLORS: readonly string[] = [
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

  const known = KNOWN_HOUSE_COLORS[trimmed];
  if (known !== undefined) return known;

  return FALLBACK_HOUSE_COLORS[hash(trimmed) % FALLBACK_HOUSE_COLORS.length];
}

/** The houses with hand-picked colours, for docs and tests. */
export function namedHouses(): string[] {
  return Object.keys(KNOWN_HOUSE_COLORS);
}
