// `processSetCardsAndPrintings` — for one canonical set, fetch cards
// from every adapter that knows about it, run them through the
// resolver, then for each canonical card fetch printings, classify
// them, and emit canonical printings.
//
// Adapter set-key resolution: each adapter that emitted a `RawSet`
// for this canonical key carries its own `sourceKey` we feed back
// into `listCardsForSet`. Adapters with no matching raw set
// contribute zero cards (they don't know about it).
//
// Per-adapter try/catch lives here. A throw on a single adapter for
// this set surfaces as a `fetch_cards` / `fetch_printings`
// SeedRunError but does not abort the set's processing.

import { Reporter } from './report.js';
import { canonicalCardKey, printingVariantKey } from '../../canonical-keys.js';
import { type AdapterLogger, type SourceAdapter } from '../../interfaces/adapter.js';
import { decideMasterSetMembership, type MasterSetDecisionInput } from '../../master-set/index.js';
import {
  resolveCanonicalCards,
  resolveCanonicalPrintings,
  type TieredRecords,
} from '../../resolver/resolver.js';
import { classifyVariant } from '../../variant-classify.js';

import type {
  CanonicalCard,
  CanonicalPrinting,
  CanonicalSet,
  RawCard,
  RawPrinting,
  RawSet,
} from '../../types.js';

export interface ProcessedPrinting {
  readonly canonical: CanonicalPrinting;
  readonly raw: RawPrinting;
  /** Source adapter that emitted the primary printing — drives image lookup. */
  readonly source: string;
}

export interface ProcessedCard {
  readonly canonical: CanonicalCard;
  readonly printings: ReadonlyArray<ProcessedPrinting>;
}

export interface ProcessSetResult {
  readonly cards: ReadonlyArray<ProcessedCard>;
}

/**
 * Process every card + printing in `set`. Bounded by the per-card
 * loop's `limitCards` (when supplied) — useful for fast smoke tests.
 *
 * The fn does NOT touch the DB or the image pipeline. Those are
 * downstream stages composed on top of this one.
 */
export async function processSet(args: {
  readonly canonicalSet: CanonicalSet;
  readonly adapters: ReadonlyArray<SourceAdapter>;
  /** Per-adapter raw sets returned by `enumerateSets`. */
  readonly rawByAdapter: ReadonlyMap<string, ReadonlyArray<RawSet>>;
  readonly reporter: Reporter;
  readonly logger: AdapterLogger;
  readonly limitCards?: number | null;
}): Promise<ProcessSetResult> {
  const { canonicalSet, adapters, rawByAdapter, reporter, logger, limitCards } = args;

  // ----- Collect cards from each adapter that recognises this set -----
  const cardTiers: TieredRecords<RawCard> = { primary: [], validation: [], filler: [] };
  for (const adapter of adapters) {
    const rawSets = rawByAdapter.get(adapter.name) ?? [];
    const matchingRaw = rawSets.find(
      (rs) =>
        rs.language === canonicalSet.language &&
        rs.code.trim().toLowerCase() === canonicalSet.code.trim().toLowerCase(),
    );
    if (!matchingRaw) continue;
    try {
      const cards = await reporter.time('fetch_cards', () =>
        adapter.listCardsForSet(matchingRaw.sourceKey),
      );
      cardTiers[adapter.tier].push(...cards);
      reporter.incPerSource(adapter.name, 'cardsFetched', cards.length);
      logger.info(
        {
          source: adapter.name,
          set: canonicalSet.canonicalKey,
          count: cards.length,
        },
        'seed.fetch_cards.ok',
      );
    } catch (cause) {
      reporter.recordError({
        kind: 'fetch_cards',
        source: adapter.name,
        setKey: matchingRaw.sourceKey,
        cause,
      });
      logger.error(
        {
          source: adapter.name,
          set: canonicalSet.canonicalKey,
          err: describeError(cause),
        },
        'seed.fetch_cards.failed',
      );
    }
  }

  // ----- Resolve cards into canonical form -----
  const setLookupForResolver = new Map([
    [
      `${canonicalSet.language}-${canonicalSet.code.trim().toLowerCase()}`,
      { canonicalKey: canonicalSet.canonicalKey },
    ],
  ]);

  const { canonical: canonicalCards } = await reporter.time('resolve_classify', async () => {
    const result = resolveCanonicalCards(cardTiers, setLookupForResolver, {
      onConflict: (c) => reporter.recordResolverConflicts('card', c.chosenSource, 1),
    });
    for (const card of result.canonical) {
      reporter.recordResolverAgreements(card.sourceMetadata);
    }
    return result;
  });

  const limited =
    typeof limitCards === 'number' && limitCards > 0
      ? canonicalCards.slice(0, limitCards)
      : canonicalCards;

  // ----- Per canonical card: pull printings, classify, master-set decide -----
  const processedCards: ProcessedCard[] = [];

  for (const canonicalCard of limited) {
    const printingTiers: TieredRecords<RawPrinting> = {
      primary: [],
      validation: [],
      filler: [],
    };
    /** Map from RawPrinting → source adapter name. */
    const printingSource = new Map<RawPrinting, string>();

    for (const adapter of adapters) {
      // Find this adapter's raw-card key for the canonical card we're processing.
      const tierBucket = adapter.tier;
      const rawCard = cardTiers[tierBucket].find(
        (rc) => rcCanonicalKey(rc, setLookupForResolver) === canonicalCard.canonicalKey,
      );
      if (!rawCard) continue;
      try {
        const prints = await reporter.time('fetch_cards', () =>
          adapter.listPrintingsForCard(rawCard.sourceKey),
        );
        printingTiers[adapter.tier].push(...prints);
        for (const p of prints) printingSource.set(p, adapter.name);
        reporter.incPerSource(adapter.name, 'printingsFetched', prints.length);
      } catch (cause) {
        reporter.recordError({
          kind: 'fetch_printings',
          source: adapter.name,
          cardKey: rawCard.sourceKey,
          cause,
        });
        logger.error(
          {
            source: adapter.name,
            card: canonicalCard.canonicalKey,
            err: describeError(cause),
          },
          'seed.fetch_printings.failed',
        );
      }
    }

    // Classifier runs ONLY on primary printings — they own variant identity.
    const classifiedEntries: Array<{
      raw: RawPrinting;
      cardCanonicalKey: string;
      variantClass: ReturnType<typeof classifyVariant>['variant_class'];
      variantFlags: ReturnType<typeof classifyVariant>['variant_flags'];
      variantCode: string;
      includeInMasterSet: boolean;
      includeInMasterSetDefault: boolean;
    }> = [];
    const masterDecisionInputs: MasterSetDecisionInput[] = [];

    // Synthesize the RawCard (primary tier) and RawSet shapes the
    // classifier needs. We pull the matching raw card/set from the
    // resolver inputs above when available; fall back to a compact
    // synthesis on canonical fields otherwise.
    const rawSetForClassifier = synthRawSetFromCanonical(canonicalSet);
    const rawCardForClassifier = synthRawCardFromCanonical(canonicalCard, rawSetForClassifier);

    for (const raw of printingTiers.primary) {
      const classified = classifyVariant(raw, rawCardForClassifier, rawSetForClassifier);
      const variantKey = printingVariantKey(
        { variantCode: classified.variant_code, cardKey: raw.cardKey },
        { canonicalKey: canonicalCard.canonicalKey },
      );
      classifiedEntries.push({
        raw,
        cardCanonicalKey: canonicalCard.canonicalKey,
        variantClass: classified.variant_class,
        variantFlags: classified.variant_flags,
        variantCode: classified.variant_code,
        includeInMasterSet: classified.include_in_master_set_default,
        includeInMasterSetDefault: classified.include_in_master_set_default,
      });
      masterDecisionInputs.push({
        variantKey,
        variantClass: classified.variant_class,
        variantFlags: classified.variant_flags,
        includeInMasterSetDefault: classified.include_in_master_set_default,
      });
    }

    // Master-set rules engine: returns the FINAL include flag per variant.
    const decision = decideMasterSetMembership({
      set: { canonicalKey: canonicalSet.canonicalKey, masterSetRules: canonicalSet.masterSetRules },
      printings: masterDecisionInputs,
    });

    // Fold final master-set flag back onto each classified entry.
    for (const entry of classifiedEntries) {
      const variantKey = printingVariantKey(
        { variantCode: entry.variantCode, cardKey: entry.raw.cardKey },
        { canonicalKey: entry.cardCanonicalKey },
      );
      const finalIncluded = decision.decisions.get(variantKey);
      if (typeof finalIncluded === 'boolean') {
        entry.includeInMasterSet = finalIncluded;
      }
      const overridden = decision.overridesApplied.has(variantKey);
      reporter.recordVariantClass(entry.variantClass);
      reporter.recordMasterSetDecision(entry.includeInMasterSet, overridden);
    }

    // Resolver assembles canonical printings with filler image URLs.
    const { canonical: canonicalPrintings } = resolveCanonicalPrintings(
      printingTiers,
      classifiedEntries,
      {
        onConflict: (c) => reporter.recordResolverConflicts('printing', c.chosenSource, 1),
      },
    );

    const processedPrintings: ProcessedPrinting[] = [];
    for (const cp of canonicalPrintings) {
      const matchedEntry = classifiedEntries.find((e) => e.variantCode === cp.variantCode);
      const raw = matchedEntry?.raw;
      if (!raw) continue;
      const source = printingSource.get(raw) ?? '';
      processedPrintings.push({ canonical: cp, raw, source });
    }

    processedCards.push({ canonical: canonicalCard, printings: processedPrintings });
  }

  return { cards: processedCards };
}

// ============================================================
// Internals
// ============================================================

function rcCanonicalKey(
  rc: RawCard,
  setLookup: ReadonlyMap<string, { canonicalKey: string }>,
): string | undefined {
  const setKey = `${rc.language}-${rc.setCode.trim().toLowerCase()}`;
  const set = setLookup.get(setKey);
  if (!set) return undefined;
  return canonicalCardKey(rc, set);
}

/**
 * Compact `RawSet` for the classifier when we don't have the
 * adapter's original raw set on hand. The classifier only reads
 * `printedTotal` plus the language and code (for `RawSet` shape);
 * everything else is unused.
 */
function synthRawSetFromCanonical(canonical: CanonicalSet): RawSet {
  return {
    source: 'canonical-synth',
    sourceKey: canonical.canonicalKey,
    code: canonical.code,
    language: canonical.language,
    name: canonical.name,
    series: canonical.series ?? null,
    releaseDate: canonical.releaseDate,
    printedTotal: canonical.printedTotal ?? null,
    total: canonical.total ?? null,
    logoUrl: canonical.logoUrl ?? null,
    symbolUrl: canonical.symbolUrl ?? null,
  };
}

function synthRawCardFromCanonical(canonical: CanonicalCard, set: RawSet): RawCard {
  return {
    source: 'canonical-synth',
    sourceKey: canonical.canonicalKey,
    setCode: set.code,
    language: canonical.language,
    number: canonical.number,
    name: canonical.name,
    nameLocalized: canonical.nameLocalized ?? null,
    typeRaw: null,
    subtypeRaw: null,
    hp: canonical.hp ?? null,
    illustrator: canonical.illustrator ?? null,
    flavorText: canonical.flavorText ?? null,
    attacks: canonical.attacks ?? null,
    weakness: canonical.weakness ?? null,
    resistance: canonical.resistance ?? null,
    retreatCost: canonical.retreatCost ?? null,
    rarityRaw: null,
  };
}

function describeError(err: unknown): { name: string; message: string } {
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { name: 'unknown', message: String(err) };
}
