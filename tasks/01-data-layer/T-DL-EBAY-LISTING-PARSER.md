# T-DL-EBAY-LISTING-PARSER — eBay listing title parser (slab + grade + condition + card identification)

**Stage:** 01-data-layer
**Agent role:** data
**Effort:** L
**Status:** in_progress

---

## Hard dependencies

- **T-DL-SOURCE-INTERFACES** (merged) — `RateLimitedClient`, `RawSet/RawCard/RawPrinting` types, normalize helpers. We do not consume the HTTP client (the parser is offline-pure) but we share the `Language` enum, the variant-class taxonomy, and the canonical-key generators.
- **T-DL-SCHEMA-CARDS** (merged) — `card.canonical_key`, `printing.variant_key`, the `card.number` text-with-leading-zeros invariant, and the `set.canonical_key = "{language}-{code}"` shape the joiner ultimately resolves against.

## Soft dependencies

- **T-DL-PRICING-EBAY-BROWSE** — consumes `parseEbayListing()` to attribute eBay Browse active-listing observations to a `(printing, grade_tier)` tuple.
- **T-DL-PRICING-AGGREGATOR** — consumes `parseEbayListing()` (or its joiner output) when the aggregator emits raw eBay-sold listing titles that need normalization.
- **T-DL-FX-RATES** — irrelevant at parse time (pricing is stored in source currency), but the parser's grade-tier output is the join key the rollup job uses.

## Required reading

- `PROJECT.md` § 6 (Data Model), § 13 (Pricing & Affiliate Strategy)
- `rules/01-data-layer.md`
- `context/tcg-domain.md` § 1 (variant taxonomy), § 5 (canonical keys), § 8 (variant decision tree)
- `context/data-model.md` § "Grade tiers"
- `context/conventions.md`
- `packages/db/src/schema/grading.ts` — `grade_company` enum (`'PSA' | 'BGS' | 'CGC' | 'SGC' | 'OTHER'`)
- `packages/db/src/schema/{cards,printings,sets}.ts` — what the joiner ultimately resolves to
- `packages/db/src/schema/prices.ts` — `price_observation.grade_tier` (free-form `text`, validated by canonical enum from `data-model.md`)
- `data-pipeline/src/canonical-keys.ts` — `canonicalSetKey`, `canonicalCardKey`
- `data-pipeline/README.md`

## Goal

eBay listing titles ("PSA 10 GEM MINT Charizard 4/102 Base Set 1999 Holo Rare", "Pokemon Lot of 50 Cards Bulk!", "Japanese Eevee Heroes Sylveon V Alt Art 091/069") are the raw material for two pricing layers: Layer 1 (the paid aggregator's eBay-sold ingestion) and Layer 2 (our own eBay Browse active-listing crawl). Both need to attribute every observation to a `(printing, grade_tier)` tuple — otherwise we cannot aggregate, cannot graph, cannot price.

This task ships a **pure, deterministic, offline parser** that turns a free-text eBay listing title into a structured `ParsedListing` with: slab indicator + grading company + numeric grade + grade tier; raw-card condition; language; set + card-number + name hints; orthogonal variant hints (holo / RH / 1st-Ed / shadowless / full-art / alt-art / promo / rainbow / gold / pattern); lot-listing flag (so multi-card "binder" or "lot of 100" listings are NOT counted as single-card pricing observations); a 0..1 confidence score; and an array of unparsed tokens for transparency. Alongside the parser ships a `resolveListingToPrinting(parsed, db)` joiner that maps a `ParsedListing` to a `(card_id, printing_id)` via the canonical-key lookup defined in `tcg-domain.md` § 5.

The parser sits in `data-pipeline/src/parsers/ebay-listing/` and exports through the package barrel. It is **not** a `SourceAdapter` (it doesn't fetch card-data from a third-party source — it interprets text from one); it's a standalone module shared by every downstream pricing job. All passes are pure, stateless, dependency-free, and individually testable.

## Deliverables

| Path | Purpose |
|---|---|
| `data-pipeline/src/parsers/ebay-listing/index.ts` | Public barrel — exports `parseEbayListing`, `ParsedListing`, `resolveListingToPrinting`, helper types |
| `data-pipeline/src/parsers/ebay-listing/types.ts` | `parsedListingSchema` (zod) + inferred `ParsedListing` type + grade-tier enum + condition enum |
| `data-pipeline/src/parsers/ebay-listing/grade-scales.ts` | PSA / BGS / CGC / SGC / OTHER grade-scale tables + `gradeToTier()` mapper consistent with `data-model.md` § "Grade tiers" |
| `data-pipeline/src/parsers/ebay-listing/parse.ts` | `parseEbayListing(title: string): ParsedListing` — main entry, runs ordered passes, computes confidence |
| `data-pipeline/src/parsers/ebay-listing/passes/preclean.ts` | Unicode normalize, lowercase, strip emoji, collapse whitespace |
| `data-pipeline/src/parsers/ebay-listing/passes/grade.ts` | Slab + grading-company + numeric-grade extraction |
| `data-pipeline/src/parsers/ebay-listing/passes/lot.ts` | Multi-card / bulk / sealed-pack detection (flag and short-circuit) |
| `data-pipeline/src/parsers/ebay-listing/passes/language.ts` | Japanese-listing detection |
| `data-pipeline/src/parsers/ebay-listing/passes/variants.ts` | Variant-class hints (holo / RH / 1st-Ed / shadowless / FA / AA / promo / rainbow / gold / patterns) + rarity hints (V / VMAX / VSTAR / EX / GX / ex / BREAK) |
| `data-pipeline/src/parsers/ebay-listing/passes/set-number.ts` | "Charizard 4/102", "TG18/TG30", "GG70 Crown Zenith", "SWSH284" extraction + set-name dictionary lookup |
| `data-pipeline/src/parsers/ebay-listing/passes/name.ts` | Card-name hint extraction from residual tokens |
| `data-pipeline/src/parsers/ebay-listing/passes/condition.ts` | Raw-card NM / LP / MP / HP / DMG inference (only when not slab) |
| `data-pipeline/src/parsers/ebay-listing/joiner.ts` | `resolveListingToPrinting(parsed, db)` — canonical-key catalog lookup with variant narrowing |
| `data-pipeline/src/parsers/ebay-listing/README.md` | Pass-ordering rationale + corpus composition + confidence model + downstream-consumer notes |
| `data-pipeline/src/parsers/ebay-listing/parse.test.ts` | Full-title round-trips for the 100+ corpus |
| `data-pipeline/src/parsers/ebay-listing/passes/preclean.test.ts` | Per-pass unit tests |
| `data-pipeline/src/parsers/ebay-listing/passes/grade.test.ts` | Per-pass unit tests |
| `data-pipeline/src/parsers/ebay-listing/passes/lot.test.ts` | Per-pass unit tests |
| `data-pipeline/src/parsers/ebay-listing/passes/language.test.ts` | Per-pass unit tests |
| `data-pipeline/src/parsers/ebay-listing/passes/variants.test.ts` | Per-pass unit tests |
| `data-pipeline/src/parsers/ebay-listing/passes/set-number.test.ts` | Per-pass unit tests |
| `data-pipeline/src/parsers/ebay-listing/passes/name.test.ts` | Per-pass unit tests |
| `data-pipeline/src/parsers/ebay-listing/passes/condition.test.ts` | Per-pass unit tests |
| `data-pipeline/src/parsers/ebay-listing/joiner.test.ts` | Catalog-join round-trip against synthetic in-memory fixtures |
| `data-pipeline/src/parsers/ebay-listing/grade-scales.test.ts` | Grade-tier mapping coverage (every `data-model.md` tier produced for at least one canonical input) |
| `data-pipeline/src/parsers/ebay-listing/confidence.test.ts` | Confidence-distribution calibration over the corpus |
| `data-pipeline/src/parsers/ebay-listing/corpus.ts` | The hand-crafted test corpus (100+ titles, each tagged with expected partial output for round-trip assertions) |

### Pre-authorized out-of-scope edit

- `data-pipeline/src/index.ts` — append the single line `export * from './parsers/ebay-listing/index.js';` so the barrel surface is consistent. No other changes to that file.

## Output type (`ParsedListing`)

Defined as a zod schema in `types.ts`. Inferred TS type:

```ts
{
  rawTitle: string;
  cleanedTitle: string;
  grading: {
    company: 'PSA' | 'BGS' | 'CGC' | 'SGC' | 'OTHER' | null;
    grade: number | null;            // 0..10 numeric
    gradeLabel: string | null;       // 'GEM MINT' | 'BLACK LABEL' | 'PRISTINE' | etc.
    isSlab: boolean;
    gradeTier: GradeTier | null;     // PSA_10 | BGS_10_BLACK | CGC_10_PRISTINE | OTHER_GRADED | null
  };
  condition: Condition | null;       // 'MINT' | 'NEAR_MINT' | 'LIGHTLY_PLAYED' | 'MODERATELY_PLAYED' | 'HEAVILY_PLAYED' | 'DAMAGED' | null
  language: 'en' | 'jp' | 'unknown';
  set: { codeHint: string | null; nameHint: string | null };
  card: { numberHint: string | null; nameHint: string | null };
  variantHints: {
    isHolo: boolean | null;
    isReverseHolo: boolean | null;
    isFirstEdition: boolean | null;
    isShadowless: boolean | null;
    isFullArt: boolean | null;
    isAltArt: boolean | null;
    isPromo: boolean | null;
    isRainbow: boolean | null;
    isGold: boolean | null;
    isSecretRare: boolean | null;
    isStaff: boolean | null;
    isPrerelease: boolean | null;
    isPokeBallPattern: boolean | null;
    isMasterBallPattern: boolean | null;
    rarityHint: 'V' | 'VMAX' | 'VSTAR' | 'EX' | 'GX' | 'ex' | 'BREAK' | 'TAG_TEAM' | 'MEGA' | null;
  };
  isLot: boolean;
  lotSize: number | null;            // null when listing flagged as a lot but size could not be parsed
  confidenceScore: number;           // 0..1
  matchedSignals: string[];          // diagnostic; e.g. ['grade','slab','set:swsh9','number','holo']
  unparsedTokens: string[];          // tokens not claimed by any pass (transparency / iterative improvement)
}
```

Mirrors the schema's `grade_company` enum (`PSA | BGS | CGC | SGC | OTHER`) — `AGS`, `ACE`, and any future grader bucket through `OTHER` (consistent with `price_observation.grade_tier = OTHER_GRADED`). The full numeric scale is captured for diagnostic round-tripping; the *grade tier* (the join key the rollup job actually uses) is derived from the company + numeric grade by `grade-scales.ts` and exposed on the output.

## Pass strategy

Token-based extraction with **eight ordered passes** running on a single mutable working string. Each pass:

1. Receives the current `working` string and the in-progress `ParsedListing`.
2. Runs its regex set; on a match, mutates the `ParsedListing` and *redacts* the matched span from `working` (replaces matched chars with whitespace) so later passes don't re-claim the same tokens.
3. Pushes a label to `matchedSignals` for every successful claim — later inspected for confidence scoring and surfaced for downstream debugging.

Pass order (later passes assume earlier ones have already consumed their structures):

1. **preclean.** Lowercase. Replace fancy quotes (`'"`) with ASCII (`'"`). Replace em/en/figure dashes with `-`. Strip Pokémon-irrelevant emoji and bullets. Normalize Unicode (NFKC). Collapse whitespace runs. Output: cleaned working string + a token array for transparency.
2. **grade.** Slab + company + numeric grade + label. Highest precision; runs before lot detection so `"PSA 10 Lot of 5 Pokemon Cards"` still flags both. Sets `grading.{company, grade, gradeLabel, isSlab, gradeTier}`. Validates the numeric grade against the company-specific scale (`grade-scales.ts`). On `"graded"` without a numeric grade → `isSlab=true`, everything else null (downstream signals partial-match).
3. **lot.** Multi-card / bulk / sealed-pack / complete-set detection. Flags `isLot` and parses `lotSize` when an `\d+` is associated. Short-circuits the rest of the pipeline's confidence model — lots are not single-card observations.
4. **language.** `japanese`, `japan`, `jpn`, `1st edition japanese` → `language='jp'`. `JP` alone is too ambiguous (set codes contain `JP`); only triggers inside a known phrase. Default `unknown` (most listings are EN; we don't emit `'en'` unless a positive signal fires — keeps the field honest).
5. **variants.** Variant flags + rarity hints (in *that* order — `reverse holo` matched before plain `holo`, `vmax`/`vstar` before plain `v`, etc.). Sets the `variantHints.*` booleans (or `null` when no signal — distinct from `false`, which would assert "explicitly not"). Avoids classifying anything; downstream variant-classifier (`variant-classify.ts`) is the source of truth for the final `variant_class`.
6. **set-number.** Try patterns in descending specificity:
   - `\b(?<num>\d+)\s*\/\s*(?<denom>\d+)\b` (Modern: `4/102`, `091/069`)
   - `\b(?<prefix>tg|gg|sw|swsh|sm|xy|hgss|dp|bw|np)\s*(?<num>\d+)(?:\s*\/\s*\d+)?\b` (Promo / sub-set numbering: `TG18`, `GG70`, `SWSH284`)
   - `\b(?<num>\d+)\s+of\s+(?<denom>\d+)\b` (Vintage: `4 of 102`)
   Then probe a small dictionary (`SET_NAME_TO_CODE`) for set-name signals: `base set`, `jungle`, `fossil`, `team rocket`, `gym heroes`, `crown zenith`, `obsidian flames`, `paldea evolved`, `temporal forces`, `evolving skies`, `lost origin`, `silver tempest`, `brilliant stars`, `pokemon 151`, `paradox rift`, `shrouded fable`, `surging sparks`, `vivid voltage`, `sword shield`, `chilling reign`, `hidden fates`, `champions path`, `darkness ablaze`, `rebel clash`, `astral radiance`, `fusion strike`, `evolutions`, etc. Modern-era priority — vintage coverage is partial (documented in README).
7. **name.** Card-name hint extraction from residual tokens. We ship a `POKEMON_NAME_DICT` covering ~100 common species names (charizard, pikachu, mewtwo, mew, blastoise, venusaur, eevee + Eeveelutions, gengar, dragonite, gyarados, lugia, ho-oh, rayquaza, the SV-era featured species, etc.) plus common trainer-card name fragments. The pass picks the longest matched name; if none matches, falls back to the longest contiguous run of letter-only tokens (capitalised in the original or not — case-insensitive after preclean) excluding stop words.
8. **condition.** Only runs when `isSlab === false`. Maps `nm`, `near mint`, `lp`, `lightly played`, `mp`, `moderately played`, `hp`, `heavily played`, `played`, `damaged`, `dmg`, `poor`, `mint` (without `near`) to the canonical condition enum. Two-letter abbreviations (`nm`, `lp`, etc.) require word boundaries on both sides to avoid clobbering set codes like `np` or `bw`.

Final confidence is a sum of pass contributions, capped at `[0, 1]`:

| Signal matched | Contribution |
|---|---|
| `grade.isSlab && grade.grade != null` | +0.30 |
| `grade.isSlab` only (no numeric grade) | +0.15 |
| `set.codeHint || set.nameHint` (resolved to a known code) | +0.10 |
| `card.numberHint` | +0.20 |
| `card.nameHint` (matched from `POKEMON_NAME_DICT`) | +0.20 |
| `card.nameHint` (residual token fallback) | +0.10 |
| ≥1 `variantHints.*` signal | +0.10 |
| `condition != null` (raw cards only) | +0.10 |
| `language === 'jp'` | +0.05 |
| `isLot` | -0.10 (a lot is not a single-card observation; downstream pricing should drop) |
| `unparsedTokens.length > 0.5 * total tokens` | -0.10 |

Calibrated against the corpus to satisfy the AC threshold (≥95% of slab-listings score ≥0.7; ≥80% of raw single-card listings score ≥0.6; lots score arbitrarily — they're filtered upstream by `isLot`).

## Catalog joiner

`resolveListingToPrinting(parsed, db)` returns `{ cardId: string | null, printingId: string | null, confidence: number }`.

Algorithm:

1. **Refuse lots.** If `parsed.isLot`, return `{ cardId: null, printingId: null, confidence: 0 }`.
2. **Build canonical card key** when both a set hint and a number hint are present:
   - `setCode = parsed.set.codeHint ?? lookupSetCodeByName(parsed.set.nameHint)`
   - `language = parsed.language === 'unknown' ? 'en' : parsed.language`
   - `canonicalKey = canonicalCardKey({ number: parsed.card.numberHint }, { language, code: setCode })`
   - Lookup → `{ id }`. If hit, store as `cardId`.
3. **Fallback to name + set lookup** when canonical lookup misses or set-code unknown: query by `(name LIKE parsed.card.nameHint, set.canonical_key = ...)`. Marked low-confidence in the result.
4. **Narrow printings** by variant hints: prefer printings whose `variant_class` matches the asserted hint (RH > FA > AA > Holo > Non-holo) and whose `variant_flags` include the asserted modifier (`FIRST_EDITION` if `isFirstEdition`, `SHADOWLESS` if `isShadowless`, etc.).
5. **Confidence:** product of `parsed.confidenceScore` with a join-quality factor (1.0 for canonical-key hit, 0.6 for name-fallback, 0.3 for "found a card but no variant match").

The joiner is **DB-shape-agnostic**: it accepts a small interface (`ParserCatalogReader`) with three async methods (`findCardByCanonicalKey`, `findCardsByNameAndSetCode`, `findPrintingsByCardId`), so the same module is testable with synthetic in-memory fixtures and pluggable with a real `@binderly/db` query layer when the downstream pricing tasks wire it up. Tests use the in-memory variant.

## Test corpus

`corpus.ts` ships ≥100 hand-crafted titles covering the patterns enumerated below. Every entry is a `{ title, expected: Partial<ParsedListing> }` so `parse.test.ts` round-trips every entry with `expect(parsed).toMatchObject(expected)`. No live eBay scraping; titles are synthesised from public listing patterns documented in `PROJECT.md` § 13 and the parser author's domain knowledge.

Composition (≥100 entries, breakdown approximate; actual counts surfaced in PR body and README):

| Subset | Approx. count | Notes |
|---|---|---|
| PSA-graded slabs | 18 | Grades 7-10, vintage + modern, with and without "GEM MINT" label |
| BGS-graded slabs (incl. Black Label) | 10 | 8.5 / 9 / 9.5 / 10 / Black-Label-10 |
| CGC-graded slabs (incl. Pristine) | 8 | 9 / 9.5 / 10 / Pristine-10 |
| SGC + AGS / ACE (→ `OTHER`) | 4 | Validates `OTHER_GRADED` tier path |
| Raw NM single cards | 12 | Modern + vintage |
| Raw LP / MP / HP / DMG | 8 | Each condition represented |
| Lot listings | 10 | "Lot of N", "100x", "complete set", "binder", "bulk" |
| Japanese listings | 10 | Vintage 1st-Ed JP + modern Pokemon Center JP |
| Variant-bearing listings | 12 | Holo, RH, 1st-Ed, Shadowless, FA, AA / SIR, Rainbow, Gold, Secret, Promo |
| Trainer Gallery / Galarian Gallery | 4 | `TG18/TG30`, `GG70` numbering |
| Pokemon Center stamp / promo | 4 | "Pokemon Center stamped", "Black Star Promo" |
| Mislabeled / typo-laden / pathological | 8 | Parser must fail gracefully — `unparsedTokens` populated, low confidence, never throws |

## Acceptance criteria

- [ ] `parseEbayListing(title)` returns a `ParsedListing` for every title in `corpus.ts`. The output round-trips through `parsedListingSchema.parse()` (zod) without errors.
- [ ] Slab extraction passes for every PSA / BGS / CGC / SGC / AGS entry in the corpus: `grading.isSlab === true`, `grading.company` matches expected, `grading.grade` matches the numeric grade, `grading.gradeTier` is the expected canonical tier from `data-model.md` § "Grade tiers".
- [ ] Raw-card condition extraction passes for every raw entry in the corpus: `grading.isSlab === false`, `condition` matches expected.
- [ ] Lot detection: `isLot === true` for every lot entry; `isLot === false` for every single-card entry. Zero false positives on the single-card subset.
- [ ] Variant hints fire correctly: every variant-bearing entry has its asserted `variantHints.is*` flag set to `true` and unrelated flags to `null`.
- [ ] Set + number extraction succeeds for the modern-era subset (≥95% precision); README documents the partial-success rate for the vintage subset.
- [ ] Confidence calibration test (`confidence.test.ts`) asserts: ≥95% of slab corpus entries score ≥0.7; ≥80% of raw single-card corpus entries score ≥0.6; every lot entry has `isLot === true` regardless of score.
- [ ] Joiner round-trips parsed listings to canonical card / printing keys for a synthetic in-memory catalog fixture (no live DB; `joiner.test.ts`).
- [ ] Every regex in the parser has been tested in isolation against pathological inputs (long sequences of repeated chars, deeply nested whitespace, unicode garbage). No catastrophic-backtracking regression.
- [ ] All passes are pure functions (no I/O, no clocks, no `Math.random`).
- [ ] No new runtime dependencies. `zod` is already in `@binderly/data-pipeline`.
- [ ] `pnpm --filter @binderly/data-pipeline build typecheck lint format:check test` clean.
- [ ] Tests live under `data-pipeline/src/parsers/ebay-listing/**/*.test.ts` and pass under `pnpm --filter @binderly/data-pipeline test`.
- [ ] No file modified outside `owns_paths` + the 1-line barrel re-export in `data-pipeline/src/index.ts`.

## Out of scope

- Live eBay HTTP fetching. The parser is offline-pure; the eBay Browse API client lives in `T-DL-PRICING-EBAY-BROWSE`.
- DB writes. The joiner returns identifiers; persisting `price_observation` rows is `T-DL-PRICING-EBAY-BROWSE` / `T-DL-PRICING-AGGREGATOR`.
- Currency / FX handling. `price_observation` is stored in source currency; conversion happens at display time via `T-DL-FX-RATES` and `packages/pricing-display`.
- Adapter / `SourceAdapter` interface conformance. The parser is not a card-data source.
- Title parsers for marketplaces other than eBay (Cardmarket / TCGplayer). Cardmarket comes via aggregator only; TCGplayer is closed.

## Branch & PR

- Branch: `agent/T-DL-EBAY-LISTING-PARSER`
- PR title: `T-DL-EBAY-LISTING-PARSER: eBay listing title parser (slab + grade + condition + card identification)`
- Commit format: Conventional Commits (`feat(data-pipeline): …` for the implementation commit, `docs(tasks): …` for this elaboration)

## Escalation triggers

Append to `open-questions.md` and STOP if:

- The corpus reveals a variant signal that doesn't fit the existing variant taxonomy in `tcg-domain.md` § 1 / § 8 (e.g. a brand-new ETB-promo stamp class). Propose a § 8 patch — same precedent as TCGDEX-EN's reorder.
- A grading company / scale is missing from `packages/db/src/schema/grading.ts` (`grading_training_sample.grade_company` enum) — propose a schema patch and coordinate with downstream pricing tasks. We bucket AGS / ACE under `OTHER` for now per the existing enum; if a major grader is missing entirely, escalate.
- The "right" pass ordering surfaces ambiguities that need product input (e.g. how to attribute a `"PSA 10 + 1st Ed Holo"` listing — does the slab override the variant for the join, or do we still try to resolve to the 1st-Ed-Holo printing?). Current default: variant hints describe the *underlying printing*, the slab describes the *grade tier*. Both ride together — the joiner picks the printing first, the grade tier second. Document any deviation.

## Notes from execution

_(sub-agent appendix — see PR body)_
