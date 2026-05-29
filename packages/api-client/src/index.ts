// `@binderly/api-client` — public barrel.
//
// External consumers (web, mobile, scanner, shareable SSR) MUST
// import from this entry point. Deep imports like
// `@binderly/api-client/resources/cards` are not exposed in the
// package.json `exports` map; tree-shaking handles the dead-code
// elimination.
//
// Surface area:
//
//   - `createClient(config)` — the single factory that returns
//     a `BinderlyClient` with seven resource namespaces.
//   - `BinderlyClient` + per-resource interfaces — the typed
//     contract every consumer programs against.
//   - The full error taxonomy (`ApiError` + every subclass) —
//     consumers branch on `instanceof` or `error.code`.
//   - The env loader (`loadClientEnv`) for callers who want a
//     typed reading of `process.env` / `Deno.env.toObject()` /
//     a custom env source.
//   - The `HttpClient` low-level core, exported because the
//     scanner package may want to add its own resource modules
//     on top.

import { HttpClient, type FetchLike, type JwtProvider } from './client.js';
import { makeAuthResource, type AuthResource } from './resources/auth.js';
import { makeCardsResource, type CardsResource } from './resources/cards.js';
import { makeCollectionResource, type CollectionResource } from './resources/collection.js';
import {
  makeCommunitySubmissionsResource,
  type CommunitySubmissionsResource,
} from './resources/communitySubmissions.js';
import { makeEntitlementsResource, type EntitlementsResource } from './resources/entitlements.js';
import { makeGradingResource, type GradingResource } from './resources/grading.js';
import { makePricingResource, type PricingResource } from './resources/pricing.js';
import { makeProfileResource, type ProfileResource } from './resources/profile.js';
import { makeShareablesResource, type ShareablesResource } from './resources/shareables.js';
import {
  makeSmartCollectionsResource,
  type SmartCollectionsResource,
} from './resources/smartCollections.js';

import type { SupabaseClient } from '@supabase/supabase-js';

// ============================================================
// Public types
// ============================================================

/**
 * Construction options for {@link createClient}. Mirrors
 * `HttpClientConfig` plus the optional Supabase auth client for
 * the `auth` resource.
 */
export interface CreateClientConfig {
  /** Base URL for the Binderly backend (e.g. `https://abc.supabase.co`). */
  readonly baseUrl: string;
  /** Supabase anon key — public-by-design value safe to ship to clients. */
  readonly apiKey: string;
  /** Returns the current user JWT, or `null` for anonymous calls. */
  readonly getJwt: JwtProvider;
  /** Optional `fetch` override (tests inject a stub here). Defaults to `globalThis.fetch`. */
  readonly fetch?: FetchLike;
  /**
   * Optional Supabase JS client for the `auth` resource. If omitted,
   * the auth resource builds its own internally on first use with
   * browser-friendly defaults (`persistSession: true`,
   * `autoRefreshToken: true`, `detectSessionInUrl: true`). Provide
   * your own when you want to share the session listener with the
   * rest of your app, OR when you're running server-side and need
   * persistence disabled.
   */
  readonly supabaseAuth?: SupabaseClient;
  /** Default headers merged into every request (e.g. `'x-binderly-app': 'web'`). */
  readonly defaultHeaders?: Readonly<Record<string, string>>;
}

/**
 * The single typed client returned by {@link createClient}. Each
 * property is a resource namespace; resources are stateless and
 * safe to invoke concurrently.
 */
export interface BinderlyClient {
  readonly cards: CardsResource;
  readonly collection: CollectionResource;
  readonly pricing: PricingResource;
  readonly grading: GradingResource;
  readonly shareables: ShareablesResource;
  readonly profile: ProfileResource;
  readonly auth: AuthResource;
  readonly smartCollections: SmartCollectionsResource;
  readonly entitlements: EntitlementsResource;
  readonly communitySubmissions: CommunitySubmissionsResource;
  /**
   * Escape hatch: the underlying `HttpClient` for callers that
   * need to issue ad-hoc requests against an endpoint this
   * package doesn't surface yet (e.g. an early-access Edge
   * Function). Resource methods should be preferred — direct
   * `http.request` calls bypass the typed-DTO surface.
   */
  readonly http: HttpClient;
}

// ============================================================
// Factory
// ============================================================

/**
 * Build a {@link BinderlyClient}. Construction is cheap (no I/O)
 * so consumers may freely re-create per request server-side or
 * memoize for the lifetime of the app client-side.
 */
export function createClient(config: CreateClientConfig): BinderlyClient {
  const httpConfig: ConstructorParameters<typeof HttpClient>[0] = {
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    getJwt: config.getJwt,
    ...(config.fetch !== undefined ? { fetch: config.fetch } : {}),
    ...(config.defaultHeaders !== undefined ? { defaultHeaders: config.defaultHeaders } : {}),
  };
  const http = new HttpClient(httpConfig);
  const authResource = makeAuthResource({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    ...(config.supabaseAuth !== undefined ? { supabaseAuth: config.supabaseAuth } : {}),
  });
  return Object.freeze({
    http,
    cards: makeCardsResource(http),
    collection: makeCollectionResource(http),
    pricing: makePricingResource(http),
    grading: makeGradingResource(http),
    shareables: makeShareablesResource(http),
    profile: makeProfileResource(http),
    auth: authResource,
    smartCollections: makeSmartCollectionsResource(http),
    entitlements: makeEntitlementsResource(http),
    communitySubmissions: makeCommunitySubmissionsResource(http),
  });
}

// ============================================================
// Re-exports
// ============================================================

export {
  ApiAuthError,
  ApiConflictError,
  ApiError,
  ApiForbiddenError,
  ApiNetworkError,
  ApiNotFoundError,
  ApiRateLimitError,
  ApiResponseDecodeError,
  ApiServerError,
  ApiUnauthorizedError,
  ApiValidationError,
  errorFromResponse,
  readErrorEnvelope,
  type ApiErrorCode,
  type ApiErrorOptions,
} from './error.js';

export {
  HttpClient,
  type FetchLike,
  type FetchResponseLike,
  type HttpClientConfig,
  type JwtProvider,
  type RequestOptions,
} from './client.js';

export { loadClientEnv, REQUIRED_ENV_KEYS, type ClientEnv, type EnvSource } from './env.js';

export type {
  AuthResource,
  AuthResourceConfig,
  SignInWithMagicLinkOptions,
  SignInWithOAuthOptions,
  SignInWithOAuthResult,
} from './resources/auth.js';
export type {
  CardsResource,
  ListCardsInSetOptions,
  ListPageOptions,
  ListPrintingsForCardOptions,
  ListSetsOptions,
} from './resources/cards.js';
export type { CollectionResource, ListCollectionItemsOptions } from './resources/collection.js';
export type { CommunitySubmissionsResource } from './resources/communitySubmissions.js';
export type { EntitlementsResource } from './resources/entitlements.js';
export type { GradingResource, ListGradingSubmissionsOptions } from './resources/grading.js';
export type {
  GetCurrentPriceOptions,
  GetFxRateOptions,
  GetPriceHistoryOptions,
  GetPrintingCurrentPriceOptions,
  PricingResource,
} from './resources/pricing.js';
export type { ProfileResource } from './resources/profile.js';
export type { ShareablesResource } from './resources/shareables.js';
export type { SmartCollectionsResource } from './resources/smartCollections.js';
