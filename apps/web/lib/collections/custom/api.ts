// Typed data-fetch helpers for the `/collections/custom` surfaces.
//
// Wraps `@binderly/api-client`'s `collection.*` resource (the
// custom-collection CRUD + member-membership endpoints) with the
// narrow surface this stage needs. View components program against
// `CustomCollectionApi` rather than the full `BinderlyClient` so
// tests can hand-roll a fake the same way T-W-BROWSE / T-W-COLLECTION
// did for theirs.
//
// Every method here calls a `/v1/me/...` endpoint which the Edge
// Function layer (T-BE-EDGE-FUNCTIONS) gates behind `requireUser()`.
// Routes that consume `CustomCollectionApi` MUST sit behind the
// auth-gate guard (`<SignInPrompt>` rendered by the Route component
// when `useAuth()` reports no session).
//
// Manual-only scope: the underlying resource is shared with smart
// collections (T-W-SMART, parallel sibling) but every helper here
// targets the manual side. Smart-collection rows surfaced by
// `listCustomCollections` are filtered out at the view layer; the
// detail surface treats a smart row as "not a manual collection,
// 404 it" since smart-collection editing is owned by T-W-SMART.

import type { BinderlyClient } from '@binderly/api-client';
import type {
  CustomCollectionDto,
  CustomCollectionItemDto,
  PrintingWithContextDto,
  SetDto,
  CardWithPrintingsDto,
} from '@binderly/api-contracts';

/**
 * Free-tier hard cap on **manual** custom collections per Project
 * spec § 9 / § 16. Smart collections aren't counted here — they
 * have their own gate (free = 0 saved, paid = unlimited) owned by
 * T-W-SMART.
 *
 * Exposed so view components, tests, and the upgrade copy share a
 * single source of truth.
 */
export const FREE_TIER_CUSTOM_COLLECTION_CAP = 3;

/**
 * The narrow read-/write-side contract every custom-collection view
 * programs against. Real production pages get this via
 * `apiToCustomCollectionApi(getApiClient())`; tests get it from
 * `createFakeCustomCollectionApi({ ... })` in the test fixtures.
 */
export interface CustomCollectionApi {
  readonly listCustomCollections: (signal?: AbortSignal) => Promise<CustomCollectionDto[]>;
  readonly getCustomCollection: (id: string, signal?: AbortSignal) => Promise<CustomCollectionDto>;
  readonly createCustomCollection: (
    input: CreateManualCustomCollectionInput,
    signal?: AbortSignal,
  ) => Promise<CustomCollectionDto>;
  readonly updateCustomCollection: (
    input: { id: string; patch: UpdateManualCustomCollectionInput },
    signal?: AbortSignal,
  ) => Promise<CustomCollectionDto>;
  readonly deleteCustomCollection: (id: string, signal?: AbortSignal) => Promise<void>;
  readonly listCustomCollectionItems: (
    customCollectionId: string,
    signal?: AbortSignal,
  ) => Promise<CustomCollectionItemDto[]>;
  readonly addPrintingToCustomCollection: (
    input: { customCollectionId: string; printingId: string },
    signal?: AbortSignal,
  ) => Promise<CustomCollectionItemDto>;
  readonly removePrintingFromCustomCollection: (
    input: { customCollectionId: string; printingId: string },
    signal?: AbortSignal,
  ) => Promise<void>;
  /**
   * Resolve a list of printing ids to fully-contextualized rows
   * (printing + parent card + parent set) so the detail surface can
   * render member tiles without N more set/card lookups in the view.
   * Implemented as a fan-out over `getPrinting` so it works against
   * the catalog endpoints that exist today; if a bulk lookup lands
   * later we swap the body and the contract is unchanged.
   */
  readonly getPrintingsByIds: (
    ids: ReadonlyArray<string>,
    signal?: AbortSignal,
  ) => Promise<PrintingWithContextDto[]>;
  /** Catalog read used by the printing-picker modal. */
  readonly listAllSets: (signal?: AbortSignal) => Promise<SetDto[]>;
  /** Catalog read used by the printing-picker modal — cards-with-printings for a set. */
  readonly listSetCardsWithPrintings: (
    setId: string,
    signal?: AbortSignal,
  ) => Promise<CardWithPrintingsDto[]>;
}

/**
 * Manual-only subset of the create body. The underlying contract is
 * a discriminated union over `kind`; we narrow to `manual` here so
 * the view never has to remember to pass `kind: 'manual'` (and the
 * smart-collection sibling never accidentally calls into this path
 * with `kind: 'smart'`).
 */
export interface CreateManualCustomCollectionInput {
  readonly name: string;
  readonly slug: string;
  readonly description?: string | null;
  readonly coverUrl?: string | null;
}

export interface UpdateManualCustomCollectionInput {
  readonly name?: string;
  readonly slug?: string;
  readonly description?: string | null;
  readonly coverUrl?: string | null;
}

const MAX_CATALOG_PAGES = 100;

export function apiToCustomCollectionApi(client: BinderlyClient): CustomCollectionApi {
  return {
    async listCustomCollections(signal): Promise<CustomCollectionDto[]> {
      return client.collection.listCustomCollections(signal !== undefined ? { signal } : {});
    },

    async getCustomCollection(id, signal): Promise<CustomCollectionDto> {
      return client.collection.getCustomCollection({
        id,
        ...(signal !== undefined ? { signal } : {}),
      });
    },

    async createCustomCollection(input, signal): Promise<CustomCollectionDto> {
      const body = {
        kind: 'manual' as const,
        name: input.name,
        slug: input.slug,
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.coverUrl !== undefined ? { coverUrl: input.coverUrl } : {}),
      };
      return client.collection.createCustomCollection(body, signal !== undefined ? { signal } : {});
    },

    async updateCustomCollection({ id, patch }, signal): Promise<CustomCollectionDto> {
      return client.collection.updateCustomCollection({
        id,
        patch,
        ...(signal !== undefined ? { signal } : {}),
      });
    },

    async deleteCustomCollection(id, signal): Promise<void> {
      return client.collection.deleteCustomCollection({
        id,
        ...(signal !== undefined ? { signal } : {}),
      });
    },

    async listCustomCollectionItems(
      customCollectionId,
      signal,
    ): Promise<CustomCollectionItemDto[]> {
      return client.collection.listCustomCollectionItems({
        customCollectionId,
        ...(signal !== undefined ? { signal } : {}),
      });
    },

    async addPrintingToCustomCollection(
      { customCollectionId, printingId },
      signal,
    ): Promise<CustomCollectionItemDto> {
      return client.collection.addPrintingToCustomCollection({
        customCollectionId,
        body: { printingId },
        ...(signal !== undefined ? { signal } : {}),
      });
    },

    async removePrintingFromCustomCollection(
      { customCollectionId, printingId },
      signal,
    ): Promise<void> {
      return client.collection.removePrintingFromCustomCollection({
        customCollectionId,
        printingId,
        ...(signal !== undefined ? { signal } : {}),
      });
    },

    async getPrintingsByIds(ids, signal): Promise<PrintingWithContextDto[]> {
      // Members are bounded by the cap of "user-curated picks per
      // collection" — well under a few hundred even for power
      // users. Sequential fan-out keeps the request count
      // predictable; we can swap to a batch endpoint when one lands.
      const out: PrintingWithContextDto[] = [];
      for (const id of ids) {
        const opts = signal !== undefined ? { id, signal } : { id };
        out.push(await client.cards.getPrinting(opts));
      }
      return out;
    },

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

    async listSetCardsWithPrintings(setId, signal): Promise<CardWithPrintingsDto[]> {
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
            const printingOpts =
              signal !== undefined ? { cardId: card.id, signal } : { cardId: card.id };
            const printings = await client.cards.listPrintingsForCard(printingOpts);
            return { ...card, printings } satisfies CardWithPrintingsDto;
          }),
        );
        cards.push(...expanded);
        if (res.nextCursor === null) break;
        cursor = res.nextCursor;
      }
      return cards;
    },
  };
}

/**
 * Filter to the manual-only subset of a custom-collection list.
 * Smart collections are surfaced by the same backend resource but
 * are owned by T-W-SMART; the manual list view treats them as
 * invisible.
 */
export function manualOnly(rows: ReadonlyArray<CustomCollectionDto>): CustomCollectionDto[] {
  return rows.filter((row) => row.kind === 'manual');
}
