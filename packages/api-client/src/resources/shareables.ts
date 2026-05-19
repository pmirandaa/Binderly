// Shareables resource — owner CRUD over `shareable` rows plus
// the public render path (anonymous read by `(handle, slug)`).
//
// Owner methods (`/v1/me/shareables/...`) require an authenticated
// session. The public read (`/v1/c/{handle}/{slug}`) is anonymous —
// the SSR shareable page in the web app uses it without ever
// touching the user's JWT. The client surfaces this distinction
// by passing `anonymous: true` on the public-read request.

import { z } from 'zod';

import {
  createShareableRequest,
  publicShareableDto,
  shareableDto,
  updateShareableRequest,
  type CreateShareableRequest,
  type PublicShareableDto,
  type ShareableDto,
  type UpdateShareableRequest,
} from '@binderly/api-contracts';

import { validateRequest } from './_validate.js';

import type { HttpClient } from '../client.js';

export interface ShareablesResource {
  readonly listShareables: (options?: { readonly signal?: AbortSignal }) => Promise<ShareableDto[]>;
  readonly getShareable: (input: {
    readonly id: string;
    readonly signal?: AbortSignal;
  }) => Promise<ShareableDto>;
  readonly createShareable: (
    input: CreateShareableRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<ShareableDto>;
  readonly updateShareable: (input: {
    readonly id: string;
    readonly patch: UpdateShareableRequest;
    readonly signal?: AbortSignal;
  }) => Promise<ShareableDto>;
  readonly deleteShareable: (input: {
    readonly id: string;
    readonly signal?: AbortSignal;
  }) => Promise<void>;
  /**
   * Public render of a shareable — anonymous, no JWT required.
   * Used by the SSR page at `/c/{handle}/{slug}`. The Edge Function
   * resolves `(handle, slug)` → `(user_id, shareable_id)` server-side,
   * then returns the corresponding `shareableDto`.
   *
   * Returns only the bare `shareableDto`. Use
   * {@link getPublicShareablePayload} for the richer SSR-ready
   * envelope.
   */
  readonly getPublicShareable: (input: {
    readonly handle: string;
    readonly slug: string;
    readonly signal?: AbortSignal;
  }) => Promise<ShareableDto>;
  /**
   * Richer public-shareable read — same anonymous endpoint
   * (`GET /v1/c/{handle}/{slug}`) but returns the full
   * `publicShareableDto` envelope (owner subset + counts +
   * member list + collection title). Matches the
   * `PublicSharePayload` shape declared in
   * `apps/web/lib/share/api.ts`; closes Q-012.
   */
  readonly getPublicShareablePayload: (input: {
    readonly handle: string;
    readonly slug: string;
    readonly signal?: AbortSignal;
  }) => Promise<PublicShareableDto>;
}

const shareableArraySchema = z.array(shareableDto);

export function makeShareablesResource(http: HttpClient): ShareablesResource {
  return {
    async listShareables(options = {}): Promise<ShareableDto[]> {
      return http.request(
        {
          path: '/v1/me/shareables',
          method: 'GET',
          ...(options.signal !== undefined ? { signal: options.signal } : {}),
        },
        shareableArraySchema,
      );
    },

    async getShareable({ id, signal }): Promise<ShareableDto> {
      return http.request(
        {
          path: `/v1/me/shareables/${encodeURIComponent(id)}`,
          method: 'GET',
          ...(signal !== undefined ? { signal } : {}),
        },
        shareableDto,
      );
    },

    async createShareable(input, options = {}): Promise<ShareableDto> {
      const body = validateRequest(createShareableRequest, input, 'createShareableRequest');
      return http.request(
        {
          path: '/v1/me/shareables',
          method: 'POST',
          body,
          ...(options.signal !== undefined ? { signal: options.signal } : {}),
        },
        shareableDto,
      );
    },

    async updateShareable({ id, patch, signal }): Promise<ShareableDto> {
      const body = validateRequest(updateShareableRequest, patch, 'updateShareableRequest');
      return http.request(
        {
          path: `/v1/me/shareables/${encodeURIComponent(id)}`,
          method: 'PATCH',
          body,
          ...(signal !== undefined ? { signal } : {}),
        },
        shareableDto,
      );
    },

    async deleteShareable({ id, signal }): Promise<void> {
      return http.requestVoid({
        path: `/v1/me/shareables/${encodeURIComponent(id)}`,
        method: 'DELETE',
        ...(signal !== undefined ? { signal } : {}),
      });
    },

    async getPublicShareable({ handle, slug, signal }): Promise<ShareableDto> {
      return http.request(
        {
          path: `/v1/c/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}`,
          method: 'GET',
          anonymous: true,
          ...(signal !== undefined ? { signal } : {}),
        },
        shareableDto,
      );
    },

    async getPublicShareablePayload({ handle, slug, signal }): Promise<PublicShareableDto> {
      return http.request(
        {
          path: `/v1/c/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}`,
          method: 'GET',
          anonymous: true,
          // The server distinguishes `Accept: application/vnd.binderly.share+json`
          // from the bare `getPublicShareable` request — same URL, two
          // representations. Keeps the URL stable for `<link
          // rel="canonical">` while letting the SSR page pull the
          // richer payload in one round-trip.
          headers: { accept: 'application/vnd.binderly.share+json' },
          ...(signal !== undefined ? { signal } : {}),
        },
        publicShareableDto,
      );
    },
  };
}
