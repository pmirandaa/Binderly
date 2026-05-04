# `parsers/ebay-listing`

Pure, deterministic, offline parser for free-text eBay listing
titles. Used by the Layer-2 eBay Browse adapter
(`T-DL-PRICING-EBAY-BROWSE`) and the Layer-1 aggregator's title
normalisation (`T-DL-PRICING-AGGREGATOR`) to attribute pricing
observations to the right `(card, printing, grade_tier)` tuple.

## Public surface

```ts
import {
  parseEbayListing, // (title) => ParsedListing
  resolveListingToPrinting, // (parsed, db) => { cardId, printingId, confidence }
  ParsedListing,
  ParserCatalogReader,
} from '@binderly/data-pipeline';

const parsed = parseEbayListing('PSA 10 Charizard 4/102 Base Set Holo');
// → { grading: { company: 'PSA', grade: 10, gradeTier: 'PSA_10', isSlab: true },
//     set: { codeHint: 'base1', nameHint: 'base set' },
//     card: { numberHint: '4', nameHint: 'charizard' },
//     variantHints: { isHolo: true, ... },
//     confidenceScore: 0.9, ... }
```

## Pass ordering

```
preclean → grade → lot → language → variants → set-number → name → condition
```

Each pass is a pure function that takes the current working string
and the in-progress `ParsedListing`, mutates the listing, and
_redacts_ its matched span from the working string (replaces with
spaces) so subsequent passes don't re-claim the same tokens.

| Pass           | Why first                                                                                                                                                         | Why second / etc.                                                         |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **preclean**   | Every other pass needs lowercased, NFKC-normalised, emoji-stripped input.                                                                                         | n/a                                                                       |
| **grade**      | Highest-precision pass. Output drives confidence accounting and gates the condition pass (raw-only).                                                              | After preclean.                                                           |
| **lot**        | After grade so `"PSA 10 Lot of 5 Pokemon Cards"` still flags both.                                                                                                | n/a                                                                       |
| **language**   | Independent; scans the raw title for CJK script + the working string for `japanese` keyword. Doesn't redact `1st edition` so the variants pass still picks it up. | After grade so JP slabs work.                                             |
| **variants**   | Specific patterns (`reverse holo`, `1st edition`) before generic ones (`holo`). Rarity-hint patterns (`vmax`, `vstar`, `v`) ordered specific-first.               | After language redacts `japanese`.                                        |
| **set-number** | Three patterns in descending specificity: `\d+/\d+`, `(TG\|GG\|SWSH...)\d+`, `\d+ of \d+`. Then dictionary lookup for set names.                                  | After variants so `1st edition` doesn't get confused for a number.        |
| **name**       | Dictionary match (~150 species) wins; falls back to longest letter-only token run after stop-word filtering.                                                      | After set-number redacts the number/set tokens.                           |
| **condition**  | Only runs when not a slab. Multi-word patterns (`near mint`, `lightly played`) before abbreviations (`nm`, `lp`).                                                 | Last so abbreviations don't mis-fire on tokens claimed by earlier passes. |

## Confidence model

Sum, capped at `[0, 1]`, rounded to 2 decimal places:

| Signal                                | Δ     |
| ------------------------------------- | ----- |
| slab + numeric grade                  | +0.30 |
| slab only (`graded` without number)   | +0.15 |
| set codeHint OR nameHint              | +0.10 |
| numberHint                            | +0.20 |
| nameHint from species dictionary      | +0.20 |
| nameHint fallback (longest token run) | +0.10 |
| ≥1 variant flag asserted              | +0.10 |
| condition (raw cards only)            | +0.10 |
| language='jp'                         | +0.05 |
| isLot                                 | -0.10 |
| >50% tokens unparsed                  | -0.10 |

Calibrated against the corpus in `corpus.ts` to satisfy the
acceptance criteria:

- ≥95% of slab corpus entries score ≥ 0.7
- ≥80% of raw single-card corpus entries score ≥ 0.6
- 0% false-positive lot detection on single-card slab/raw entries

The actual values are asserted in `confidence.test.ts`.

## Test corpus composition

Hand-crafted in `corpus.ts`. NO live eBay scraping — every title is
a representative pattern synthesised from public listing patterns
documented in `PROJECT.md` § 13.

Corpus is ~108 entries spanning:

| Category          | Count | Purpose                                                                                 |
| ----------------- | ----- | --------------------------------------------------------------------------------------- |
| `psa-slab`        | 18    | PSA grades 6-10, modern + vintage, with/without GEM MINT                                |
| `bgs-slab`        | 10    | BGS 8.5-10 incl. Black Label                                                            |
| `cgc-slab`        | 8     | CGC 8.5-10 incl. Pristine                                                               |
| `other-slab`      | 4     | SGC + AGS + ACE → `OTHER_GRADED` tier                                                   |
| `raw-nm`          | 12    | Raw NM single cards, modern + vintage                                                   |
| `raw-played`      | 8     | LP / MP / HP / DMG / Played                                                             |
| `lot`             | 10    | Lot of N, Nx, complete set, binder, sealed product, ETB                                 |
| `jp`              | 10    | Vintage 1st-Ed JP + modern Pokemon Center JP                                            |
| `variant`         | 12    | 1st-Ed / Shadowless / FA / AA / Rainbow / Gold / Secret / Promo / RH / pattern variants |
| `subset-numbered` | 4     | TG / GG / SWSH-prefix promo numbering                                                   |
| `pokemon-center`  | 4     | Pokemon Center stamped, staff, prerelease                                               |
| `pathological`    | 8     | Mislabeled / typo-laden / emoji-spam / tiny / non-Latin                                 |

## Catalog joiner

`resolveListingToPrinting(parsed, db)` returns
`{ cardId, printingId, confidence }`.

The joiner is **DB-shape-agnostic** — it consumes a small
`ParserCatalogReader` interface (three async methods:
`findCardByCanonicalKey`, `findCardsByNameAndSetCode`,
`findPrintingsByCardId`). Tests use synthetic in-memory fixtures;
downstream pricing tasks wire it up against `@binderly/db`.

Algorithm:

1. Refuse lots → `(null, null, 0)`.
2. Build canonical card key from `(language, setCode, number)` →
   direct lookup. Hit → `joinQuality = 1.0`.
3. Fallback to name + set lookup. Hit with set →
   `joinQuality = 0.6`. Hit without set → `joinQuality = 0.4`.
4. Once a card is resolved, score every printing of that card
   against the parsed variant hints (class match, then flag
   overlap). Pick the highest score.
5. Final confidence = `clamp01(parsed.confidenceScore × joinQuality)`.

## Modern-era set coverage (partial-success rate)

The set-name dictionary in `passes/set-name-dict.ts` is biased toward
modern (Sword & Shield + Scarlet & Violet) and the WoTC vintage core
(Base / Jungle / Fossil / Team Rocket / Gym / Neo). Mid-era (EX /
DP / HGSS / BW / XY / SM) is partial coverage — not every set is
listed.

For listings whose set is not in the dictionary, the parser still
emits the card-number hint (driving `joinQuality` via
canonical-key) but `setCode` will be `null`. The downstream joiner
falls back to name-only lookup with proportionally lower confidence.

## What this parser is NOT

- Not a `SourceAdapter`. The parser doesn't fetch card-data from a
  third-party source — it interprets free-text titles. The eBay
  Browse HTTP client lives in `T-DL-PRICING-EBAY-BROWSE`.
- Not the variant classifier. `data-pipeline/src/variant-classify.ts`
  owns the canonical `variant_class` decision tree from
  `context/tcg-domain.md` § 8 — the parser emits _hints_ the
  classifier and joiner consume.
- Not a currency / FX layer. Pricing is stored in source currency;
  conversion happens at display time via `T-DL-FX-RATES` and
  `packages/pricing-display`.

## Adding new patterns

1. Add a regex to the relevant pass in `passes/*.ts`. Keep it
   non-backtracking (no `\w*\w*` style).
2. Add a tagged corpus entry to `corpus.ts` with the expected
   partial output.
3. Run `pnpm --filter @binderly/data-pipeline test` — the corpus-
   driven `parse.test.ts` covers your new entry, and
   `confidence.test.ts` reasserts the calibration.
4. If you add a new variant signal, mirror the change in the
   `variantHintsSchema` in `types.ts` and in the joiner's
   `scorePrintingAgainstHints`.
