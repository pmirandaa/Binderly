// Typed data-fetch helpers for the `/collection` surfaces.
//
// Wraps `@binderly/api-client`'s `collection.*` (owned items, auth-
// gated) and `cards.*` (catalog, public) resources with the narrow
// surface this stage needs. The stage's view components program
// against `CollectionApi` rather than the full `BinderlyClient` so
// tests can hand-roll a fake in a handful of lines, exactly the
// pattern T-W-BROWSE established for `BrowseApi`.
//
// Why we expose a `catalogRoster()` helper that pre-projects to
// `RosterCard[]` / `RosterPrinting[]`: the global completion math
// in `@binderly/set-completion` operates on the entire catalog
// (denominators = "total numbered cards in the database", "total
// master-set-included printings"). We exhaust the catalog cursor
// here once, project to the narrow roster shape, and hand a single
// blob to `computeCompletion()`. The catalog is bounded (≤ ~1000
// sets, ≤ ~30k printings) per `lib/browse/api.ts`'s MAX_CATALOG_
// PAGES comment so this is acceptable for the foundation pass.
//
// All owned-item reads require an authenticated session — the
// underlying `/v1/me/collection` endpoint gates on JWT. Routes that
// call these helpers MUST sit behind the auth-gate guard
// (`CollectionRoute` / `CollectionSetRoute` rendering the sign-in
// prompt when `useAuth()` reports no session).

import type { BinderlyClient } from '@binderly/api-client';
import type {
  CardWithPrintingsDto,
  CollectionItemDto,
  CompletionDto,
  PrintingDto,
  SetDto,
} from '@binderly/api-contracts';
import type { RosterCard, RosterPrinting } from '@binderly/set-completion';

/**
 * The narrow read-side contract every collection-stage view
 * programs against. Real production pages get this via
 * `apiToCollectionApi(getApiClient())`; tests get it from
 * `createFakeCollectionApi({ ... })` in the test fixtures.
 */
export interface CollectionApi {
  readonly listAllSets: (signal?: AbortSignal) => Promise<SetDto[]>;
  readonly getSet: (id: string, signal?: AbortSignal) => Promise<SetDto>;
  readonly listOwnedItems: (signal?: AbortSignal) => Promise<CollectionItemDto[]>;
  readonly listSetContents: (
    setId: string,
    signal?: AbortSignal,
  ) => Promise<SetContents>;
  /**
   * Catalog roster walk (O(sets × cards × printings)). Used by the
   * per-set drill-down's Owned / Missing grids for per-printing
   * resolution. The completion math previously routed through this
   * fanout has moved to {@link getCompletion}. Kept here because
   * no V2 endpoint serves the per-printing roster yet.
   */
  readonly catalogRoster: (signal?: AbortSignal) => Promise<CatalogRoster>;
  /**
   * Authoritative server-side completion math. Returns the global
   * tally + a per-set entry per set with at least one owned
   * printing. Replaces the iter-17 `catalogRoster() +
   * computeCompletion()` on-device fanout for both the home page
   * and the per-set drill-down's header bars.
   */
  readonly getCompletion: (signal?: AbortSignal) => Promise<CompletionDto>;
}

export interface SetContents {
  readonly set: SetDto;
  readonly cards: CardWithPrintingsDto[];
}

/**
 * Narrow roster projection — exactly the shape
 * `@binderly/set-completion`'s `computeCompletion` consumes. Pre-
 * projecting here keeps view code free of structural-subset
 * conversions.
 */
export interface CatalogRoster {
  readonly cards: RosterCard[];
  readonly printings: RosterPrinting[];
}

/**
 * Adapt a full `@binderly/api-client` instance to the narrower
 * `CollectionApi` surface. Mirrors the T-W-BROWSE adapter pattern
 * (exhausts pagination cursors here so views can treat the
 * catalog as a bounded list).
 */
const MAX_CATALOG_PAGES = 100;
const MAX_OWNED_PAGES = 200;

export function apiToCollectionApi(client: BinderlyClient): CollectionApi {
  return {
    async listAllSets(signal): Promise<SetDto[]> {
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
    },

    async getSet(id, signal): Promise<SetDto> {
      return client.cards.getSet({
        id,
        ...(signal !== undefined ? { signal } : {}),
      });
    },

    async listOwnedItems(signal): Promise<CollectionItemDto[]> {
      const all: CollectionItemDto[] = [];
      let cursor: string | undefined;
      // Owned items pagination has its own cap — a Pro user could
      // theoretically own tens of thousands; MAX_OWNED_PAGES at
      // limit=100 caps at ~20k which fits a year-one paid user.
      for (let page = 0; page < MAX_OWNED_PAGES; page += 1) {
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

    async listSetContents(setId, signal): Promise<SetContents> {
      const setOpts = {
        id: setId,
        ...(signal !== undefined ? { signal } : {}),
      };
      const set = await client.cards.getSet(setOpts);
      const cards: CardWithPrintingsDto[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_CATALOG_PAGES; page += 1) {
        const opts = {
          setId,
          limit: 100,
          ...(cursor !== undefined ? { cursor } : {}),
          ...(signal !== undefined ? { signal } : {}),
        };
        const res = await client.cards.listCardsInSet(opts);
        const expanded = await Promise.all(
          res.items.map(async (card) => {
            const printings = await client.cards.listPrintingsForCard({
              cardId: card.id,
              ...(signal !== undefined ? { signal } : {}),
            });
            return { ...card, printings } satisfies CardWithPrintingsDto;
          }),
        );
        cards.push(...expanded);
        if (res.nextCursor === null) break;
        cursor = res.nextCursor;
      }
      return { set, cards };
    },

    async getCompletion(signal): Promise<CompletionDto> {
      return client.collection.getCompletion({
        ...(signal !== undefined ? { signal } : {}),
      });
    },

    async catalogRoster(signal): Promise<CatalogRoster> {
      // Exhaust every set, every card in every set, every printing
      // in every card. The catalog is bounded; the helper is the
      // one place this O(sets × cards × printings) traversal lives
      // so view code stays linear.
      const sets = await this.listAllSets(signal);
      const allCards: RosterCard[] = [];
      const allPrintings: RosterPrinting[] = [];
      for (const set of sets) {
        let cursor: string | undefined;
        for (let page = 0; page < MAX_CATALOG_PAGES; page += 1) {
          const opts = {
            setId: set.id,
            limit: 100,
            ...(cursor !== undefined ? { cursor } : {}),
            ...(signal !== undefined ? { signal } : {}),
          };
          const res = await client.cards.listCardsInSet(opts);
          for (const card of res.items) {
            allCards.push({ cardId: card.id, setId: card.setId });
            const printings = await client.cards.listPrintingsForCard({
              cardId: card.id,
              ...(signal !== undefined ? { signal } : {}),
            });
            for (const printing of printings) {
              allPrintings.push(projectPrinting(printing, card.setId));
            }
          }
          if (res.nextCursor === null) break;
          cursor = res.nextCursor;
        }
      }
      return { cards: allCards, printings: allPrintings };
    },
  };
}

/**
 * Convert a `CardWithPrintingsDto[]` shape (the per-set fetch
 * result) into the narrow roster a view component can pass straight
 * to `computeCompletion`. Pre-extracted so the home page's
 * "rebuild the roster from set contents" path and tests don't
 * duplicate the structural-subset projection.
 */
export function rosterFromCardsWithPrintings(
  cards: ReadonlyArray<CardWithPrintingsDto>,
): CatalogRoster {
  const rosterCards: RosterCard[] = [];
  const rosterPrintings: RosterPrinting[] = [];
  for (const card of cards) {
    rosterCards.push({ cardId: card.id, setId: card.setId });
    for (const printing of card.printings) {
      rosterPrintings.push(projectPrinting(printing, card.setId));
    }
  }
  return { cards: rosterCards, printings: rosterPrintings };
}

function projectPrinting(printing: PrintingDto, setId: string): RosterPrinting {
  return {
    printingId: printing.id,
    cardId: printing.cardId,
    setId,
    includeInMasterSet: printing.includeInMasterSet,
  };
}

/** Helper: project a list of `CollectionItemDto` to printing ids. */
export function ownedPrintingIds(items: ReadonlyArray<CollectionItemDto>): string[] {
  return items.map((it) => it.printingId);
}
