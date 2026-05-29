// User-collection resource — collection-item CRUD, custom-collection
// CRUD (manual + smart), manual-collection item membership, and
// smart-rule expression replacement.
//
// All methods require an authenticated session — they target the
// `/v1/me/...` URL prefix that the Edge Function layer (T-BE-EDGE-
// FUNCTIONS) gates with `requireUser()`. Calling these without a
// JWT yields an {@link ApiUnauthorizedError} (HTTP 401).

import { z } from 'zod';

import {
  addCollectionItemRequest,
  addPrintingToCustomCollectionRequest,
  collectionItemDto,
  completionDto,
  createCustomCollectionRequest,
  customCollectionDto,
  customCollectionItemDto,
  paginatedResponseSchema,
  smartCollectionRuleDto,
  updateCollectionItemRequest,
  updateCustomCollectionRequest,
  updateSmartCollectionExpressionRequest,
  type AddCollectionItemRequest,
  type AddPrintingToCustomCollectionRequest,
  type CollectionItemDto,
  type CompletionDto,
  type CreateCustomCollectionRequest,
  type CustomCollectionDto,
  type CustomCollectionItemDto,
  type PaginatedResponse,
  type SmartCollectionRuleDto,
  type UpdateCollectionItemRequest,
  type UpdateCustomCollectionRequest,
  type UpdateSmartCollectionExpressionRequest,
} from '@binderly/api-contracts';

import { validateRequest } from './_validate.js';

import type { HttpClient } from '../client.js';

export interface ListCollectionItemsOptions {
  readonly cursor?: string;
  readonly limit?: number;
  readonly signal?: AbortSignal;
}

export interface CollectionResource {
  // collection_item CRUD
  readonly listCollectionItems: (
    options?: ListCollectionItemsOptions,
  ) => Promise<PaginatedResponse<CollectionItemDto>>;
  /**
   * Fetch a single `collection_item` by id (single-GET, #FU-49).
   * Closes the Q-019 gap where consumers had to re-page the list or
   * reach around the API to hydrate one row. A row that doesn't exist
   * — or isn't owned by the caller (RLS) — yields an
   * {@link ApiNotFoundError} (HTTP 404).
   */
  readonly getCollectionItem: (input: {
    readonly id: string;
    readonly signal?: AbortSignal;
  }) => Promise<CollectionItemDto>;
  /**
   * Authoritative server-side completion math — Set %, Master %,
   * All Pokémon %. Replaces the iter-17/18 client-side fanout
   * stop-gap (`apps/mobile/src/lib/collection/completion.ts` +
   * `apps/web/lib/collection/*`) once consumers swap.
   */
  readonly getCompletion: (options?: { readonly signal?: AbortSignal }) => Promise<CompletionDto>;
  readonly addCollectionItem: (
    input: AddCollectionItemRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<CollectionItemDto>;
  readonly updateCollectionItem: (input: {
    readonly id: string;
    readonly patch: UpdateCollectionItemRequest;
    readonly signal?: AbortSignal;
  }) => Promise<CollectionItemDto>;
  readonly deleteCollectionItem: (input: {
    readonly id: string;
    readonly signal?: AbortSignal;
  }) => Promise<void>;

  // custom_collection CRUD
  readonly listCustomCollections: (options?: {
    readonly signal?: AbortSignal;
  }) => Promise<CustomCollectionDto[]>;
  readonly getCustomCollection: (input: {
    readonly id: string;
    readonly signal?: AbortSignal;
  }) => Promise<CustomCollectionDto>;
  readonly createCustomCollection: (
    input: CreateCustomCollectionRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<CustomCollectionDto>;
  readonly updateCustomCollection: (input: {
    readonly id: string;
    readonly patch: UpdateCustomCollectionRequest;
    readonly signal?: AbortSignal;
  }) => Promise<CustomCollectionDto>;
  readonly deleteCustomCollection: (input: {
    readonly id: string;
    readonly signal?: AbortSignal;
  }) => Promise<void>;

  // manual-collection items
  readonly listCustomCollectionItems: (input: {
    readonly customCollectionId: string;
    readonly signal?: AbortSignal;
  }) => Promise<CustomCollectionItemDto[]>;
  /**
   * Fetch a single manual-collection membership row by
   * `(customCollectionId, printingId)` (single-GET, #FU-49). The second
   * half of the Q-019 single-GET gap. A row that doesn't exist — or a
   * collection not owned by the caller — yields an
   * {@link ApiNotFoundError} (HTTP 404).
   */
  readonly getCustomCollectionItem: (input: {
    readonly customCollectionId: string;
    readonly printingId: string;
    readonly signal?: AbortSignal;
  }) => Promise<CustomCollectionItemDto>;
  readonly addPrintingToCustomCollection: (input: {
    readonly customCollectionId: string;
    readonly body: AddPrintingToCustomCollectionRequest;
    readonly signal?: AbortSignal;
  }) => Promise<CustomCollectionItemDto>;
  readonly removePrintingFromCustomCollection: (input: {
    readonly customCollectionId: string;
    readonly printingId: string;
    readonly signal?: AbortSignal;
  }) => Promise<void>;

  // smart-rule
  readonly getSmartCollectionRule: (input: {
    readonly customCollectionId: string;
    readonly signal?: AbortSignal;
  }) => Promise<SmartCollectionRuleDto>;
  readonly updateSmartCollectionExpression: (input: {
    readonly customCollectionId: string;
    readonly body: UpdateSmartCollectionExpressionRequest;
    readonly signal?: AbortSignal;
  }) => Promise<SmartCollectionRuleDto>;
}

const collectionItemListSchema = paginatedResponseSchema(collectionItemDto);
const customCollectionArraySchema = z.array(customCollectionDto);
const customCollectionItemArraySchema = z.array(customCollectionItemDto);

export function makeCollectionResource(http: HttpClient): CollectionResource {
  return {
    async listCollectionItems(options = {}): Promise<PaginatedResponse<CollectionItemDto>> {
      return http.request(
        {
          path: '/v1/me/collection',
          method: 'GET',
          query: { cursor: options.cursor, limit: options.limit },
          ...(options.signal !== undefined ? { signal: options.signal } : {}),
        },
        collectionItemListSchema,
      );
    },

    async getCollectionItem({ id, signal }): Promise<CollectionItemDto> {
      return http.request(
        {
          path: `/v1/me/collection/${encodeURIComponent(id)}`,
          method: 'GET',
          ...(signal !== undefined ? { signal } : {}),
        },
        collectionItemDto,
      );
    },

    async getCompletion(options = {}): Promise<CompletionDto> {
      return http.request(
        {
          path: '/v1/me/collection/completion',
          method: 'GET',
          ...(options.signal !== undefined ? { signal: options.signal } : {}),
        },
        completionDto,
      );
    },

    async addCollectionItem(input, options = {}): Promise<CollectionItemDto> {
      const body = validateRequest(addCollectionItemRequest, input, 'addCollectionItemRequest');
      return http.request(
        {
          path: '/v1/me/collection',
          method: 'POST',
          body,
          ...(options.signal !== undefined ? { signal: options.signal } : {}),
        },
        collectionItemDto,
      );
    },

    async updateCollectionItem({ id, patch, signal }): Promise<CollectionItemDto> {
      const body = validateRequest(
        updateCollectionItemRequest,
        patch,
        'updateCollectionItemRequest',
      );
      return http.request(
        {
          path: `/v1/me/collection/${encodeURIComponent(id)}`,
          method: 'PATCH',
          body,
          ...(signal !== undefined ? { signal } : {}),
        },
        collectionItemDto,
      );
    },

    async deleteCollectionItem({ id, signal }): Promise<void> {
      return http.requestVoid({
        path: `/v1/me/collection/${encodeURIComponent(id)}`,
        method: 'DELETE',
        ...(signal !== undefined ? { signal } : {}),
      });
    },

    async listCustomCollections(options = {}): Promise<CustomCollectionDto[]> {
      return http.request(
        {
          path: '/v1/me/custom-collections',
          method: 'GET',
          ...(options.signal !== undefined ? { signal: options.signal } : {}),
        },
        customCollectionArraySchema,
      );
    },

    async getCustomCollection({ id, signal }): Promise<CustomCollectionDto> {
      return http.request(
        {
          path: `/v1/me/custom-collections/${encodeURIComponent(id)}`,
          method: 'GET',
          ...(signal !== undefined ? { signal } : {}),
        },
        customCollectionDto,
      );
    },

    async createCustomCollection(input, options = {}): Promise<CustomCollectionDto> {
      const body = validateRequest(
        createCustomCollectionRequest,
        input,
        'createCustomCollectionRequest',
      );
      return http.request(
        {
          path: '/v1/me/custom-collections',
          method: 'POST',
          body,
          ...(options.signal !== undefined ? { signal: options.signal } : {}),
        },
        customCollectionDto,
      );
    },

    async updateCustomCollection({ id, patch, signal }): Promise<CustomCollectionDto> {
      const body = validateRequest(
        updateCustomCollectionRequest,
        patch,
        'updateCustomCollectionRequest',
      );
      return http.request(
        {
          path: `/v1/me/custom-collections/${encodeURIComponent(id)}`,
          method: 'PATCH',
          body,
          ...(signal !== undefined ? { signal } : {}),
        },
        customCollectionDto,
      );
    },

    async deleteCustomCollection({ id, signal }): Promise<void> {
      return http.requestVoid({
        path: `/v1/me/custom-collections/${encodeURIComponent(id)}`,
        method: 'DELETE',
        ...(signal !== undefined ? { signal } : {}),
      });
    },

    async listCustomCollectionItems({
      customCollectionId,
      signal,
    }): Promise<CustomCollectionItemDto[]> {
      return http.request(
        {
          path: `/v1/me/custom-collections/${encodeURIComponent(customCollectionId)}/items`,
          method: 'GET',
          ...(signal !== undefined ? { signal } : {}),
        },
        customCollectionItemArraySchema,
      );
    },

    async getCustomCollectionItem({
      customCollectionId,
      printingId,
      signal,
    }): Promise<CustomCollectionItemDto> {
      return http.request(
        {
          path: `/v1/me/custom-collections/${encodeURIComponent(customCollectionId)}/items/${encodeURIComponent(printingId)}`,
          method: 'GET',
          ...(signal !== undefined ? { signal } : {}),
        },
        customCollectionItemDto,
      );
    },

    async addPrintingToCustomCollection({
      customCollectionId,
      body: bodyInput,
      signal,
    }): Promise<CustomCollectionItemDto> {
      const body = validateRequest(
        addPrintingToCustomCollectionRequest,
        bodyInput,
        'addPrintingToCustomCollectionRequest',
      );
      return http.request(
        {
          path: `/v1/me/custom-collections/${encodeURIComponent(customCollectionId)}/items`,
          method: 'POST',
          body,
          ...(signal !== undefined ? { signal } : {}),
        },
        customCollectionItemDto,
      );
    },

    async removePrintingFromCustomCollection({
      customCollectionId,
      printingId,
      signal,
    }): Promise<void> {
      return http.requestVoid({
        path: `/v1/me/custom-collections/${encodeURIComponent(customCollectionId)}/items/${encodeURIComponent(printingId)}`,
        method: 'DELETE',
        ...(signal !== undefined ? { signal } : {}),
      });
    },

    async getSmartCollectionRule({ customCollectionId, signal }): Promise<SmartCollectionRuleDto> {
      return http.request(
        {
          path: `/v1/me/custom-collections/${encodeURIComponent(customCollectionId)}/smart-rule`,
          method: 'GET',
          ...(signal !== undefined ? { signal } : {}),
        },
        smartCollectionRuleDto,
      );
    },

    async updateSmartCollectionExpression({
      customCollectionId,
      body: bodyInput,
      signal,
    }): Promise<SmartCollectionRuleDto> {
      const body = validateRequest(
        updateSmartCollectionExpressionRequest,
        bodyInput,
        'updateSmartCollectionExpressionRequest',
      );
      return http.request(
        {
          path: `/v1/me/custom-collections/${encodeURIComponent(customCollectionId)}/smart-rule`,
          method: 'PUT',
          body,
          ...(signal !== undefined ? { signal } : {}),
        },
        smartCollectionRuleDto,
      );
    },
  };
}
