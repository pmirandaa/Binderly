// Smart-collections resource — preview the matching printings for a
// smart-collection expression without persisting a custom collection.
//
// The owner CRUD over `custom_collection` rows lives on the
// `collection` resource (`getSmartCollectionRule`,
// `updateSmartCollectionExpression`); this resource carries the
// preview endpoint that compiles the DSL expression to a
// parameterized query and returns the first page of matches.
//
// Authenticated — the preview path runs under the user's session
// so smart rules that include `collection.*` predicates can resolve
// against the caller's owned printings. (Today's preview rejects
// `collection.*` predicates with a clear 400 — see Q-013 in
// `open-questions.md`; the bare card / set / printing predicates
// work end-to-end.)

import {
  smartPreviewRequestDto,
  smartPreviewResponseDto,
  type SmartPreviewRequestDto,
  type SmartPreviewResponseDto,
} from '@binderly/api-contracts';

import { validateRequest } from './_validate.js';

import type { HttpClient } from '../client.js';

export interface SmartCollectionsResource {
  /**
   * Compile + execute a smart-collection expression against the
   * catalog. Returns the first page of matching printings plus a
   * `nextOffset` for cursor-style pagination.
   */
  readonly preview: (
    input: SmartPreviewRequestDto,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<SmartPreviewResponseDto>;
}

export function makeSmartCollectionsResource(http: HttpClient): SmartCollectionsResource {
  return {
    async preview(input, options = {}): Promise<SmartPreviewResponseDto> {
      const body = validateRequest(smartPreviewRequestDto, input, 'smartPreviewRequest');
      return http.request(
        {
          path: '/v1/smart-collections/preview',
          method: 'POST',
          body,
          ...(options.signal !== undefined ? { signal: options.signal } : {}),
        },
        smartPreviewResponseDto,
      );
    },
  };
}
