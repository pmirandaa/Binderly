// TypeScript shapes for the slice of Bulbapedia's MediaWiki action API
// the `bulbapedia-en` adapter consumes, plus the `Parsed*`
// intermediate shapes the wikitext parsers emit.
//
// Lenient where MediaWiki itself is lenient (page titles can be
// rejected with `invalid: true`, missing pages return
// `missing: true`, no `revisions` array on missing/invalid). The
// adapter narrows these into "no data" semantics.
//
// References:
//   - https://www.mediawiki.org/wiki/API:Query
//   - https://www.mediawiki.org/wiki/API:Revisions
//   - https://www.mediawiki.org/wiki/API:Categorymembers
//   - Bulbapedia Template:CardInfobox + Template:SetInfobox
//     documentation pages.

// ============================================================
// MediaWiki API responses (formatversion=2 shape)
// ============================================================

/**
 * Slot wrapper around revision content. With `rvslots=main` we always
 * get a `main` slot containing the wikitext.
 */
export interface MediaWikiRevisionSlot {
  contentmodel?: string;
  contentformat?: string;
  content?: string;
}

export interface MediaWikiRevision {
  slots?: { main?: MediaWikiRevisionSlot };
  /** Older v2 servers occasionally surface the body at the revision level. */
  content?: string;
  contentmodel?: string;
  contentformat?: string;
}

/**
 * Page entry under `query.pages[]`. With `formatversion=2` the array
 * is in stable order.
 */
export interface MediaWikiPage {
  pageid?: number;
  ns?: number;
  title: string;
  /** When `true`, the page does not exist. Adapters treat this as a 404 sibling. */
  missing?: boolean;
  /** When `true`, the requested title was rejected (bad title). Treated as 404 sibling. */
  invalid?: boolean;
  revisions?: MediaWikiRevision[];
}

/**
 * Body of a `query.pages` shaped response. Every endpoint we use
 * folds into this shape via `formatversion=2`.
 */
export interface MediaWikiQueryRevisionsResponse {
  batchcomplete?: boolean;
  query?: {
    pages?: MediaWikiPage[];
  };
}

/**
 * Body of a `list=categorymembers` response. We only consume titles;
 * pageid is preserved for ops debugging.
 */
export interface MediaWikiCategoryMember {
  pageid?: number;
  ns?: number;
  title: string;
}

export interface MediaWikiCategoryMembersResponse {
  batchcomplete?: boolean;
  query?: {
    categorymembers?: MediaWikiCategoryMember[];
  };
  /** Continuation token for paginated category enumeration. */
  continue?: { cmcontinue?: string; continue?: string };
}

// ============================================================
// Parsed intermediate shapes (wikitext → typed dict)
// ============================================================

/**
 * Raw template block as the wikitext parser yields it.
 *
 * Example: `{{CardInfobox|cardname=Charizard|hp=120}}` parses to
 * `{ name: 'CardInfobox', params: { cardname: 'Charizard', hp: '120' } }`.
 */
export interface ParsedTemplateBlock {
  /** Template name with the leading `{{` and trailing `|` / `}}` stripped. */
  name: string;
  /** Named parameters. We do NOT preserve positional parameters from
   *  templates we don't recognize because Bulbapedia's TCG infobox
   *  family always uses named params. */
  params: Record<string, string>;
}

/**
 * Typed card-page result emitted by `parsers/card-infobox.ts`. Every
 * field is optional because Bulbapedia coverage is uneven; the
 * transform layer fills `Raw{Card,Printing}` with what it gets and
 * leaves the rest null.
 */
export interface ParsedCard {
  /** The page's canonical title (the join key for `RawCard.sourceKey`). */
  pageTitle: string;
  /** Card display name (`cardname` ?? `name` ?? page-title leading portion). */
  name?: string;
  /** Raw set name as the page uses it (`Base Set`, `Brilliant Stars`, …). */
  setName?: string;
  /** `cardno` parsed to its leading numeric / lettered token (`4` from `4/102`, `TG01` from `TG01/TG30`). */
  number?: string;
  /** Pokémon energy type (`Fire`, `Water`, …); absent on Trainer / Energy. */
  type?: string;
  /** Hit points; absent on Trainer / Energy. */
  hp?: number;
  /** Retreat cost; absent on Trainer / Energy. `-` is parsed to 0. */
  retreatCost?: number;
  /** Illustrator string (`Mitsuhiro Arita`, `5ban Graphics`, …). */
  illustrator?: string;
  /** Rarity tier as Bulbapedia spells it (`Holo Rare`, `Rare Holo VSTAR`, `Hyper Rare`, …). */
  rarity?: string;
  /** Card class (`Pokémon` / `Trainer` / `Energy`). */
  class?: string;
  /** Card sub-type for trainers / energy (`Item`, `Supporter`, `Stadium`, `Tool`, `Pokémon Tool`, `Basic`, `Special`). */
  cardType?: string;
  /** Pokémon species (`Charizard`, …). */
  species?: string;
  /** Evolution stage (`Basic`, `Stage 1`, `Stage 2`, `VSTAR`, …). */
  evostage?: string;
  /** Evolution predecessor (`Charmeleon`, …). */
  evolveFrom?: string;
  /** Regulation mark (`D`, `E`, `F`, `G`). */
  regulationMark?: string;
  /** Japanese name when surfaced on the EN card page. */
  japaneseName?: string;
  /** Raw cardno field as written (`4/102`, `TG01/TG30`, `SWSH285`). */
  cardnoRaw?: string;
  /** Did the page contain the explicit `1stEdition` infobox flag set to a truthy value? */
  isFirstEdition?: boolean;
  /** Did the page contain the explicit `shadowless` infobox flag set to a truthy value? */
  isShadowless?: boolean;
  /** Did the page contain the explicit `unlimited` infobox flag set to a truthy value? */
  isUnlimited?: boolean;
  /** The page's stamp signal when explicitly set on the dominant infobox. */
  stamp?: ParsedPrintingStamp;
  /**
   * Per-print sub-templates extracted from the "Release information"
   * area of vintage card pages. Each entry corresponds to one
   * physical print run. When present the transform branches off
   * these instead of the dominant infobox flags.
   */
  printings?: ParsedPrinting[];
}

/**
 * One historical print run extracted from a vintage card page's
 * Release information section.
 */
export interface ParsedPrinting {
  /** Human-readable label as Bulbapedia spells it (`Holo`, `1st Edition Shadowless Holo`, `Reverse Holo`, `Promo`, …). */
  label: string;
  /** Print-run class (`Holographic`, `Reverse Holographic`, `Non Holographic`, `Rainbow Rare`, `Hyper Rare`, …). */
  class?: string;
  isFirstEdition?: boolean;
  isShadowless?: boolean;
  isUnlimited?: boolean;
  stamp?: ParsedPrintingStamp;
}

export type ParsedPrintingStamp =
  | 'PRERELEASE'
  | 'STAFF'
  | 'LEAGUE'
  | 'BUILDBATTLE'
  | 'CHAMPIONSHIP';

/**
 * Typed set-page result emitted by `parsers/set-infobox.ts`.
 */
export interface ParsedSet {
  /** The page's canonical title. */
  pageTitle: string;
  /** English set name (`Base Set`, `Brilliant Stars`, …). */
  name?: string;
  /** Series (`Sword & Shield`, `Scarlet & Violet`, …). */
  series?: string;
  /** Release date in ISO `yyyy-mm-dd`. Bulbapedia stores prose dates; we parse. */
  releaseDate?: string;
  /** Numbered cards in the set (the on-card "of XXX" total). */
  printedTotal?: number;
  /** Total including secret rares. Falls back to `printedTotal` when absent. */
  total?: number;
  /** Japanese name when surfaced. */
  japaneseName?: string;
}
