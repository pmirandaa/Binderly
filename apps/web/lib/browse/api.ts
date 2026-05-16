// Typed data-fetch helpers for the browse / set / card surfaces.
//
// Wraps the catalog resource on `@binderly/api-client` with the
// narrow surface this stage needs. The stage's view components
// program against `BrowseApi` (the small subset below) rather
// than the full `BinderlyClient` so tests can hand-roll a fake
// in two lines instead of stubbing every resource namespace.
//
// All catalog reads are public (no JWT required per
// `context/data-model.md` "RLS policies (summary)"), so these
// helpers don't need the AuthProvider's session.

import type { BinderlyClient } from '@binderly/api-client';
import type {
  CardWithPrintingsDto,
  PrintingWithContextDto,
  SetDto,
} from '@binderly/api-contracts';

/**
 * The narrow read-side contract every browse-stage view
 * programs against. Real production pages get this via
 * `apiToBrowseApi(getApiClient())`; tests get it from
 * `createFakeBrowseApi({ ... })` in the test-utils.
 */
export interface BrowseApi {
  readonly listAllSets: (signal?: AbortSignal) => Promise<SetDto[]>;
  readonly getSet: (id: string, signal?: AbortSignal) => Promise<SetDto>;
  readonly listPrintingsInSet: (
    setId: string,
    signal?: AbortSignal,
  ) => Promise<PrintingsForSet>;
  readonly getPrintingDetail: (
    id: string,
    signal?: AbortSignal,
  ) => Promise<PrintingWithContextDto>;
}

export interface PrintingsForSet {
  readonly set: SetDto;
  readonly cards: CardWithPrintingsDto[];
}

/**
 * Adapt a full `@binderly/api-client` instance to the narrower
 * `BrowseApi` surface. The cards/sets/printings catalog endpoints
 * are paginated; we exhaust the cursor here so the views can
 * treat the catalog as a bounded list (set count is bounded —
 * total English + Japanese sets ≤ 1000).
 *
 * `MAX_CATALOG_PAGES` caps unbounded pagination if a backend
 * regresses. Hitting it surfaces as a logged warning rather
 * than an infinite loop.
 */
const MAX_CATALOG_PAGES = 100;

export function apiToBrowseApi(client: BinderlyClient): BrowseApi {
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

    async listPrintingsInSet(setId, signal): Promise<PrintingsForSet> {
      const setOpts = {
        id: setId,
        ...(signal !== undefined ? { signal } : {}),
      };
      const set = await client.cards.getSet(setOpts);
      // Exhaust the cards-in-set cursor, then expand each card
      // into a `CardWithPrintingsDto` (so the grid can render
      // one printing per card, the standard "set page" view).
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

    async getPrintingDetail(id, signal): Promise<PrintingWithContextDto> {
      return client.cards.getPrinting({
        id,
        ...(signal !== undefined ? { signal } : {}),
      });
    },
  };
}
