// Typed data-fetch helpers for the `/collections/smart` surfaces.
//
// Wraps `@binderly/api-client` resources used by the smart-
// collection editor + saved-collection viewer with the narrow
// `SmartCollectionsApi` surface this stage's view components
// program against. Mirrors the T-W-COLLECTION + T-W-BROWSE
// `*Api` adapter pattern: tests construct a hand-rolled fake in
// a handful of lines instead of stubbing every resource
// namespace.
//
// **DSL evaluation strategy (architectural decision).** Smart-
// collection search is performed CLIENT-SIDE for v1: we fetch a
// bounded slice of the catalog (up to `MAX_PREVIEW_PRINTINGS`
// printings, exhausting the cards-in-set cursor across every
// set so the preview's coverage matches the catalog's coverage),
// project each `(card, set, printing, collection?)` tuple into a
// `CandidateItem`, and run `evaluateExpression()` over each one
// in process. Server-side compile-to-SQL via the edge function
// (using `expressionToSql()` from `@binderly/smart-collection-
// dsl`) is the natural follow-up — the DSL package is ready, and
// the smart-rule wire (`createCustomCollection({ kind: 'smart',
// expression })` + `getSmartCollectionRule` + `updateSmart-
// CollectionExpression`) is already plumbed end-to-end.
//
// Saved smart collections live as `custom_collection` rows with
// `kind === 'smart'` plus a sibling `smart_collection_rule`
// row. We list them via `listCustomCollections()` and filter
// client-side; reading the expression of a single saved
// collection goes through `getSmartCollectionRule()`.
//
// Plan-gating reads `tier` off `getMySubscription()`. The list
// and detail surfaces hide / upsell when the user is on the free
// tier; the editor's "Save" button is disabled with an upsell
// tooltip. Free users can still PARSE / EVALUATE / SEE results —
// only persistence is gated. (PROJECT.md § 9: "Smart-collection
// search results in browse" is free; "Save a smart collection"
// is paid.)

import type { BinderlyClient } from '@binderly/api-client';
import type {
  CardWithPrintingsDto,
  CollectionItemDto,
  CreateCustomCollectionRequest,
  CustomCollectionDto,
  PrintingDto,
  SetDto,
  SmartCollectionRuleDto,
  SubscriptionDto,
  UpdateSmartCollectionExpressionRequest,
} from '@binderly/api-contracts';
import type { CandidateItem } from '@binderly/smart-collection-dsl';

/**
 * Per-set fetch result — a set + its full card list with each
 * card's printings inlined. Mirrors `BrowseApi.listPrintingsInSet`.
 */
export interface SetWithCards {
  readonly set: SetDto;
  readonly cards: CardWithPrintingsDto[];
}

/**
 * The narrow read-side contract every smart-collection-stage view
 * programs against. Real production pages get this via
 * `apiToSmartCollectionsApi(getApiClient())`; tests get it from
 * `createFakeSmartCollectionsApi({ ... })` in the fixtures
 * module.
 */
export interface SmartCollectionsApi {
  readonly listSmartCollections: (
    signal?: AbortSignal,
  ) => Promise<CustomCollectionDto[]>;
  readonly getSmartCollection: (
    id: string,
    signal?: AbortSignal,
  ) => Promise<CustomCollectionDto>;
  readonly getSmartRule: (
    customCollectionId: string,
    signal?: AbortSignal,
  ) => Promise<SmartCollectionRuleDto>;
  readonly createSmartCollection: (
    input: CreateSmartCollectionInput,
    signal?: AbortSignal,
  ) => Promise<CustomCollectionDto>;
  readonly updateSmartExpression: (
    customCollectionId: string,
    body: UpdateSmartCollectionExpressionRequest,
    signal?: AbortSignal,
  ) => Promise<SmartCollectionRuleDto>;
  readonly deleteSmartCollection: (
    customCollectionId: string,
    signal?: AbortSignal,
  ) => Promise<void>;
  readonly listOwnedItems: (signal?: AbortSignal) => Promise<CollectionItemDto[]>;
  /**
   * Fetch a bounded preview of the catalog plus per-set context
   * the DSL evaluator needs. `limit` caps the number of printings
   * fetched; defaults to `MAX_PREVIEW_PRINTINGS`. The walk is
   * breadth-first across sets so a small `limit` returns a
   * representative slice rather than a single set's worth.
   */
  readonly previewCatalog: (
    options?: { readonly limit?: number; readonly signal?: AbortSignal },
  ) => Promise<CatalogPreview>;
  readonly getSubscription: (signal?: AbortSignal) => Promise<SubscriptionDto>;
}

/**
 * Bounded catalog preview the editor and saved-collection viewer
 * evaluate the DSL against. `printings` is a flat list, capped at
 * the request `limit`; `setsById` / `cardsById` index every set
 * and card referenced by those printings so candidate-item
 * projection doesn't need any further look-ups.
 */
export interface CatalogPreview {
  readonly printings: PrintingDto[];
  readonly setsById: ReadonlyMap<string, SetDto>;
  readonly cardsById: ReadonlyMap<string, CardWithPrintingsDto>;
}

/**
 * Subset of the `createCustomCollection` request we accept here —
 * `kind` is fixed to `'smart'` and the wire's discriminated-
 * union expects the smart branch's exact shape.
 */
export type CreateSmartCollectionInput = Extract<
  CreateCustomCollectionRequest,
  { kind: 'smart' }
>;

/** Default cap on the editor's preview corpus. See file-header. */
export const MAX_PREVIEW_PRINTINGS = 200;

/** Cap on cards-in-set pagination per set. Defensive against backend regression. */
const MAX_CATALOG_PAGES = 100;

/**
 * Adapt a full `@binderly/api-client` instance to the narrower
 * `SmartCollectionsApi` surface.
 */
export function apiToSmartCollectionsApi(
  client: BinderlyClient,
): SmartCollectionsApi {
  return {
    async listSmartCollections(signal): Promise<CustomCollectionDto[]> {
      const all = await client.collection.listCustomCollections({
        ...(signal !== undefined ? { signal } : {}),
      });
      return all.filter((c) => c.kind === 'smart');
    },

    async getSmartCollection(id, signal): Promise<CustomCollectionDto> {
      return client.collection.getCustomCollection({
        id,
        ...(signal !== undefined ? { signal } : {}),
      });
    },

    async getSmartRule(customCollectionId, signal): Promise<SmartCollectionRuleDto> {
      return client.collection.getSmartCollectionRule({
        customCollectionId,
        ...(signal !== undefined ? { signal } : {}),
      });
    },

    async createSmartCollection(input, signal): Promise<CustomCollectionDto> {
      return client.collection.createCustomCollection(input, {
        ...(signal !== undefined ? { signal } : {}),
      });
    },

    async updateSmartExpression(customCollectionId, body, signal): Promise<SmartCollectionRuleDto> {
      return client.collection.updateSmartCollectionExpression({
        customCollectionId,
        body,
        ...(signal !== undefined ? { signal } : {}),
      });
    },

    async deleteSmartCollection(customCollectionId, signal): Promise<void> {
      return client.collection.deleteCustomCollection({
        id: customCollectionId,
        ...(signal !== undefined ? { signal } : {}),
      });
    },

    async listOwnedItems(signal): Promise<CollectionItemDto[]> {
      const all: CollectionItemDto[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_CATALOG_PAGES; page += 1) {
        const opts = {
          limit: 100,
          ...(cursor !== undefined ? { cursor } : {}),
          ...(signal !== undefined ? { signal } : {}),
        };
        const res = await client.collection.listCollectionItems(opts);
        all.push(...res.items);
        if (res.nextCursor === null) return all;
        cursor = res.nextCursor;
      }
      return all;
    },

    async previewCatalog(options = {}): Promise<CatalogPreview> {
      const limit = options.limit ?? MAX_PREVIEW_PRINTINGS;
      const signal = options.signal;
      const sets = await listAllSets(client, signal);
      const setsById = new Map<string, SetDto>();
      const cardsById = new Map<string, CardWithPrintingsDto>();
      const printings: PrintingDto[] = [];
      // Breadth-first across sets so a small limit still covers
      // multiple sets / languages — matches the brief's "show
      // first 200 printings as the preview".
      outer: for (const set of sets) {
        setsById.set(set.id, set);
        let cursor: string | undefined;
        for (let page = 0; page < MAX_CATALOG_PAGES; page += 1) {
          if (printings.length >= limit) break outer;
          const opts = {
            setId: set.id,
            limit: 100,
            ...(cursor !== undefined ? { cursor } : {}),
            ...(signal !== undefined ? { signal } : {}),
          };
          const res = await client.cards.listCardsInSet(opts);
          for (const card of res.items) {
            if (printings.length >= limit) break outer;
            const cardPrintings = await client.cards.listPrintingsForCard({
              cardId: card.id,
              ...(signal !== undefined ? { signal } : {}),
            });
            cardsById.set(card.id, { ...card, printings: cardPrintings });
            for (const printing of cardPrintings) {
              if (printings.length >= limit) break outer;
              printings.push(printing);
            }
          }
          if (res.nextCursor === null) break;
          cursor = res.nextCursor;
        }
      }
      return { printings, setsById, cardsById };
    },

    async getSubscription(signal): Promise<SubscriptionDto> {
      return client.profile.getMySubscription({
        ...(signal !== undefined ? { signal } : {}),
      });
    },
  };
}

async function listAllSets(
  client: BinderlyClient,
  signal: AbortSignal | undefined,
): Promise<SetDto[]> {
  const all: SetDto[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_CATALOG_PAGES; page += 1) {
    const opts = {
      limit: 100,
      ...(cursor !== undefined ? { cursor } : {}),
      ...(signal !== undefined ? { signal } : {}),
    };
    const res = await client.cards.listSets(opts);
    all.push(...res.items);
    if (res.nextCursor === null) return all;
    cursor = res.nextCursor;
  }
  return all;
}

// ============================================================
// CandidateItem projection
// ============================================================

/**
 * Project a `(printing, parent card, parent set, optional
 * collection_item)` tuple into the DSL evaluator's
 * `CandidateItem` shape. Pure — no I/O.
 *
 * Returns `null` if the printing's parent set or card is
 * missing from the lookup tables (a soft-failure guard against
 * a partial preview).
 */
export function projectCandidateItem(
  printing: PrintingDto,
  cardsById: ReadonlyMap<string, CardWithPrintingsDto>,
  setsById: ReadonlyMap<string, SetDto>,
  ownedByPrintingId: ReadonlyMap<string, CollectionItemDto>,
): CandidateItem | null {
  const card = cardsById.get(printing.cardId);
  if (card === undefined) return null;
  const set = setsById.get(card.setId);
  if (set === undefined) return null;
  const owned = ownedByPrintingId.get(printing.id);
  const candidate: CandidateItem = {
    card: {
      name: card.name,
      number: card.number,
      illustrator: card.illustrator,
      language: card.language,
      type: card.type,
      subtype: card.subtype,
      rarity: card.rarity,
      hp: card.hp,
      retreatCost: card.retreatCost,
    },
    set: {
      code: set.code,
      name: set.name,
      series: set.series,
      language: set.language,
      releaseDate: set.releaseDate,
      printedTotal: set.printedTotal,
      total: set.total,
    },
    printing: {
      variantClass: printing.variantClass,
      variantFlags: printing.variantFlags,
      variantCode: printing.variantCode,
      includeInMasterSet: printing.includeInMasterSet,
    },
    ...(owned !== undefined
      ? {
          collection: {
            condition: owned.condition,
            gradeCompany: owned.gradeCompany,
            grade: owned.grade !== null ? Number(owned.grade) : null,
            quantity: owned.quantity,
            acquiredAt: owned.acquiredAt,
          },
        }
      : {}),
  };
  return candidate;
}

/**
 * Build a printing-id → collection_item lookup map for cheap
 * candidate-item projection.
 */
export function indexOwnedItems(
  items: ReadonlyArray<CollectionItemDto>,
): ReadonlyMap<string, CollectionItemDto> {
  const map = new Map<string, CollectionItemDto>();
  for (const it of items) map.set(it.printingId, it);
  return map;
}
