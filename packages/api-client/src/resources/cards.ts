// Card-catalog resource — read-only catalog reads (sets, cards,
// printings) for both anonymous browse and authenticated app
// surfaces.
//
// Catalog tables are public-read per `context/data-model.md`
// "RLS policies (summary)" — these methods do not require a JWT
// to succeed. We still send `apikey` (Supabase requires it for
// every PostgREST call); we conditionally send `Authorization`
// when one is available so server-side personalization (e.g. a
// future "shows what you own" overlay) works when the caller is
// signed in.

import { z } from 'zod';

import {
  cardDto,
  cardWithPrintingsDto,
  paginatedResponseSchema,
  printingDto,
  printingWithContextDto,
  setDto,
  type CardDto,
  type CardWithPrintingsDto,
  type PaginatedResponse,
  type PrintingDto,
  type PrintingWithContextDto,
  type SetDto,
} from '@binderly/api-contracts';

import { ApiNotFoundError } from '../error.js';

import type { HttpClient } from '../client.js';

export interface ListPageOptions {
  readonly cursor?: string;
  readonly limit?: number;
  readonly signal?: AbortSignal;
}

export interface ListSetsOptions extends ListPageOptions {
  readonly language?: 'en' | 'jp';
}

export interface ListCardsInSetOptions extends ListPageOptions {
  readonly setId: string;
}

export interface ListPrintingsForCardOptions {
  readonly cardId: string;
  readonly signal?: AbortSignal;
}

export interface GetSetBySlugOptions {
  /** The set's `canonical_key` slug (e.g. `en-base1`). */
  readonly slug: string;
  readonly signal?: AbortSignal;
}

export interface CardsResource {
  readonly listSets: (options?: ListSetsOptions) => Promise<PaginatedResponse<SetDto>>;
  readonly getSet: (options: {
    readonly id: string;
    readonly signal?: AbortSignal;
  }) => Promise<SetDto>;
  /**
   * Resolve a set by its `canonical_key` slug (e.g. `en-base1`). The
   * catalog exposes `/v1/sets/:id` by UUID only — there is no by-slug
   * endpoint — so this scans the (bounded) `/v1/sets` list and matches
   * on `canonicalKey`, which is unique. Throws {@link ApiNotFoundError}
   * when no set matches. Shared by the web + mobile `/sets/[slug]`
   * routes so both platforms resolve slugs the same way (#FU-64).
   */
  readonly getSetBySlug: (options: GetSetBySlugOptions) => Promise<SetDto>;
  readonly listCardsInSet: (options: ListCardsInSetOptions) => Promise<PaginatedResponse<CardDto>>;
  readonly getCard: (options: {
    readonly id: string;
    readonly signal?: AbortSignal;
  }) => Promise<CardWithPrintingsDto>;
  readonly listPrintingsForCard: (options: ListPrintingsForCardOptions) => Promise<PrintingDto[]>;
  readonly getPrinting: (options: {
    readonly id: string;
    readonly signal?: AbortSignal;
  }) => Promise<PrintingWithContextDto>;
}

const setListSchema = paginatedResponseSchema(setDto);
// Upper bound on pages walked while resolving a slug → set. EN + JP
// sets total well under 1000 rows; at 100/page this cap (100 pages =
// 10k rows) is a safety valve against a backend pagination regression,
// never reached in practice.
const MAX_SET_SCAN_PAGES = 100;
const cardListSchema = paginatedResponseSchema(cardDto);
// Listing printings for a card is bounded (a card has at most a
// couple dozen printings) so the endpoint returns the array
// directly rather than the cursor-paginated wrapper.
const printingArraySchema = z.array(printingDto);

export function makeCardsResource(http: HttpClient): CardsResource {
  return {
    async listSets(options = {}): Promise<PaginatedResponse<SetDto>> {
      return http.request(
        {
          path: '/v1/sets',
          method: 'GET',
          query: {
            cursor: options.cursor,
            limit: options.limit,
            language: options.language,
          },
          ...(options.signal !== undefined ? { signal: options.signal } : {}),
        },
        setListSchema,
      );
    },

    async getSet({ id, signal }): Promise<SetDto> {
      return http.request(
        {
          path: `/v1/sets/${encodeURIComponent(id)}`,
          method: 'GET',
          ...(signal !== undefined ? { signal } : {}),
        },
        setDto,
      );
    },

    async getSetBySlug({ slug, signal }): Promise<SetDto> {
      let cursor: string | undefined;
      for (let page = 0; page < MAX_SET_SCAN_PAGES; page += 1) {
        const res = await http.request(
          {
            path: '/v1/sets',
            method: 'GET',
            query: { cursor, limit: 100 },
            ...(signal !== undefined ? { signal } : {}),
          },
          setListSchema,
        );
        const match = res.items.find((set) => set.canonicalKey === slug);
        if (match !== undefined) return match;
        if (res.nextCursor === null) break;
        cursor = res.nextCursor;
      }
      throw new ApiNotFoundError(`No set found with canonical key "${slug}".`);
    },

    async listCardsInSet({ setId, cursor, limit, signal }): Promise<PaginatedResponse<CardDto>> {
      return http.request(
        {
          path: `/v1/sets/${encodeURIComponent(setId)}/cards`,
          method: 'GET',
          query: { cursor, limit },
          ...(signal !== undefined ? { signal } : {}),
        },
        cardListSchema,
      );
    },

    async getCard({ id, signal }): Promise<CardWithPrintingsDto> {
      return http.request(
        {
          path: `/v1/cards/${encodeURIComponent(id)}`,
          method: 'GET',
          ...(signal !== undefined ? { signal } : {}),
        },
        cardWithPrintingsDto,
      );
    },

    async listPrintingsForCard({ cardId, signal }): Promise<PrintingDto[]> {
      return http.request(
        {
          path: `/v1/cards/${encodeURIComponent(cardId)}/printings`,
          method: 'GET',
          ...(signal !== undefined ? { signal } : {}),
        },
        printingArraySchema,
      );
    },

    async getPrinting({ id, signal }): Promise<PrintingWithContextDto> {
      return http.request(
        {
          path: `/v1/printings/${encodeURIComponent(id)}`,
          method: 'GET',
          ...(signal !== undefined ? { signal } : {}),
        },
        printingWithContextDto,
      );
    },
  };
}
