import type { Visibility } from './person';

/**
 * `organization` pages are Houses/Nations/factions — the "House of Milltree"
 * style article the hover-preview screenshot is modelled on. `topic` pages
 * are everything else with no existing record of its own: a war, a fire, a
 * famine, a kidnapping. Both shapes are otherwise identical (single markdown
 * body) — this is purely a filter/grouping label, not a schema fork.
 */
export type LoreDocType = 'organization' | 'topic';

export const LORE_DOC_TYPES: readonly LoreDocType[] = ['organization', 'topic'] as const;

/**
 * A freestanding lore article: background on a house/nation, a war, a
 * disaster, a plot — anything too long-form for `Person.notes` or
 * `DynastyEvent.description`. Stored in its own collection
 * (`data/{world}-lore.json`), cross-linked from anywhere else in the app via
 * `[[Title]]` wiki-link syntax (see `WikiText`).
 *
 * `title` doubles as the wiki-link resolution key — it's what a `[[Title]]`
 * token in any text field is matched against, case-insensitively.
 */
export interface LoreDoc {
  id: string;
  title: string;
  type: LoreDocType;
  /**
   * When `type === 'organization'`, the house/nation name this page is about,
   * if it also exists as `Person.house`/`Person.nation` elsewhere — lets the
   * tree/timeline's house and nation chips resolve straight to a lore page
   * without a separate manual link. Left unset for topic pages and for
   * organizations with no matching house/nation record.
   */
   subjectName?: string;
  /** Single markdown body, wiki-article style. May itself contain `[[Wiki Link]]` tokens. */
  body: string;
  /** Manually curated, same spirit as `DynastyEvent.relatedPersonIds` — surfaced as "Related" links on the page even if the body prose doesn't happen to mention them. */
  relatedPersonIds: string[];
  relatedEventIds: string[];
  relatedLoreIds: string[];
  /** Same meaning as on `Person`/`DynastyEvent`: a `hidden` lore page (GM-only secret history) never reaches the player projection, even via a `[[Wiki Link]]`. */
  visibility: Visibility;
}
