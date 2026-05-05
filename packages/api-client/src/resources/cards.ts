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

export interface CardsResource {
  readonly listSets: (options?: ListSetsOptions) => Promise<PaginatedResponse<SetDto>>;
  readonly getSet: (options: {
    readonly id: string;
    readonly signal?: AbortSignal;
  }) => Promise<SetDto>;
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
