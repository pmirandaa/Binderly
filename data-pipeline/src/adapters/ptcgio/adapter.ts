// `PTCGIOAdapter` — validation English source per PROJECT.md § 7.
//
// Wraps the `RateLimitedClient` and exposes the `SourceAdapter`
// surface. All HTTP goes through the client; the adapter never
// touches `globalThis.fetch` (per `rules/01-data-layer.md`).
//
// Endpoints hit (full mapping in
// `tasks/01-data-layer/T-DL-SOURCE-PTCGIO.md`):
//
//   - `/v2/sets`                          → list sets (paginated)
//   - `/v2/sets/{setId}`                  → full set object
//   - `/v2/cards?q=set.id:{setId}`        → list cards in a set
//                                           (paginated)
//   - `/v2/cards/{cardId}`                → full card (rarity, types,
//                                           attacks, tcgplayer.prices
//                                           keys for variant signals)
//
// All list endpoints return `{ data: T[], page, pageSize, count,
// totalCount }`. Single-resource endpoints return `{ data: T }`. The
// adapter strips the envelope.
//
// Rate-limit posture: 5 req/s sustained, burst 10 (per orchestrator
// guidance for free TCG APIs; matches TCGDEX-EN's choice). PTCGIO
// publishes 1000 req/day keyless (max 30/min) and 20k req/day with an
// `X-Api-Key`. The 5 rps floor is well below the with-key budget;
// keyless dev mode will hit the 30 rpm cap on long pulls (documented).
//
// API-key handling: reads `BINDERLY_PTCGIO_API_KEY` from env at
// construction OR accepts an explicit `apiKey` constructor option.
// When set, the adapter sends `X-Api-Key: <value>` on every request.
// When unset, the adapter omits the header (keyless mode).
//
// Error policy:
//   - Single-resource fetches (`getSet`, `getCard`) propagate
//     `NotFoundError` so callers can decide.
//   - List-shaped methods (`listSets`, `listCardsForSet`,
//     `listPrintingsForCard`) translate `NotFoundError` to an empty
//     array — the adapter has "no data" for that entity. The
//     resolver surfaces this as a presence asymmetry if a sibling
//     source has data (validation tier; expected for Trainer Gallery
//     cards which PTCGIO doesn't carry).

import {
  PTCGIO_SOURCE,
  ptcgioCardToPrintings,
  ptcgioCardToRaw,
  ptcgioSetToRaw,
} from './transform.js';
import { RateLimitedClient } from '../../http/rate-limited-client.js';
import {
  NotFoundError,
  type AdapterContext,
  type SourceAdapter,
} from '../../interfaces/adapter.js';

import type { PTCGIOCard, PTCGIOEnvelope, PTCGIOListEnvelope, PTCGIOSet } from './api-types.js';
import type { AdapterTier, Language, RawCard, RawPrinting, RawSet } from '../../types.js';

export const PTCGIO_HOST = 'api.pokemontcg.io' as const;
export const PTCGIO_DEFAULT_BASE_URL = 'https://api.pokemontcg.io' as const;
export const PTCGIO_BASE_PATH = '/v2' as const;
/** Conservative free-API floor — see elaborated task spec. */
export const PTCGIO_DEFAULT_RPS = 5;
export const PTCGIO_DEFAULT_BURST = 10;
/** PTCGIO caps `pageSize` at 250 for both /sets and /cards. */
export const PTCGIO_MAX_PAGE_SIZE = 250;
/** Env var read at adapter-construction time for the optional API key. */
export const PTCGIO_API_KEY_ENV = 'BINDERLY_PTCGIO_API_KEY' as const;

export interface PTCGIOAdapterConfig {
  /** RateLimitedClient pinned to `api.pokemontcg.io`. */
  http: RateLimitedClient;
  /**
   * Base path under the host. Defaults to `/v2`. Override in tests
   * that need to exercise an alternate prefix.
   */
  basePath?: string;
  /**
   * Optional API key. Falls back to the `BINDERLY_PTCGIO_API_KEY` env
   * var when undefined. Empty string is treated as "no key".
   */
  apiKey?: string;
  /** Optional shared adapter context (logger, env). */
  context?: AdapterContext;
}

export class PTCGIOAdapter implements SourceAdapter {
  readonly name = PTCGIO_SOURCE;
  readonly language: Language = 'en';
  readonly tier: AdapterTier = 'validation';

  /**
   * Validation tier doesn't claim authoritative fields by default —
   * the resolver's "primary wins" suffices. Sibling adapter tasks may
   * extend later (e.g. PTCGIO is more reliable than TCGdex for
   * `ptcgoCode` cross-source joins).
   */
  readonly authoritativeFields: ReadonlyArray<string> = [];

  private readonly http: RateLimitedClient;
  private readonly basePath: string;
  private readonly apiKey: string | undefined;
  private readonly logger: AdapterContext['logger'] | undefined;

  constructor(config: PTCGIOAdapterConfig) {
    if (!config.http) {
      throw new Error('PTCGIOAdapter: `http` (RateLimitedClient) is required');
    }
    if (config.http.host !== PTCGIO_HOST) {
      throw new Error(
        `PTCGIOAdapter: RateLimitedClient must be pinned to ${PTCGIO_HOST} (got ${config.http.host})`,
      );
    }
    this.http = config.http;
    this.basePath = (config.basePath ?? PTCGIO_BASE_PATH).replace(/\/$/, '');
    const explicitKey = config.apiKey;
    const envKey = process.env[PTCGIO_API_KEY_ENV];
    const chosen = explicitKey ?? envKey;
    this.apiKey = chosen && chosen.length > 0 ? chosen : undefined;
    this.logger = config.context?.logger;
  }

  // ------------------------------------------------------------
  // SourceAdapter
  // ------------------------------------------------------------

  async listSets(): Promise<RawSet[]> {
    const sets: RawSet[] = [];
    try {
      for await (const page of this.paginate<PTCGIOSet>(`${this.basePath}/sets`)) {
        for (const set of page) {
          if (!set?.id) continue;
          sets.push(ptcgioSetToRaw(set));
        }
      }
    } catch (err) {
      if (err instanceof NotFoundError) {
        this.logger?.warn(
          { source: this.name, target: `${this.basePath}/sets` },
          'ptcgio.listSets.empty',
        );
        return [];
      }
      throw err;
    }
    return sets;
  }

  async listCardsForSet(setKey: string): Promise<RawCard[]> {
    if (!setKey) return [];
    const cards: RawCard[] = [];
    const query = `set.id:${setKey}`;
    try {
      for await (const page of this.paginate<PTCGIOCard>(`${this.basePath}/cards`, {
        q: query,
      })) {
        for (const card of page) {
          if (!card?.id) continue;
          cards.push(ptcgioCardToRaw(card));
        }
      }
    } catch (err) {
      if (err instanceof NotFoundError) {
        this.logger?.warn(
          { source: this.name, target: `${this.basePath}/cards`, setKey },
          'ptcgio.listCardsForSet.not_found',
        );
        return [];
      }
      throw err;
    }
    return cards;
  }

  async listPrintingsForCard(cardKey: string): Promise<RawPrinting[]> {
    if (!cardKey) return [];
    const card = await this.getCard(cardKey);
    if (!card) return [];
    return ptcgioCardToPrintings(card);
  }

  // ------------------------------------------------------------
  // Granular fetches (used by sibling tasks like seed-ingest)
  // ------------------------------------------------------------

  /**
   * Fetch a single full set. Returns `null` on 404 instead of
   * throwing; surfaces all other adapter errors untouched.
   */
  async getSet(setId: string): Promise<PTCGIOSet | null> {
    if (!setId) return null;
    const target = `${this.basePath}/sets/${encodeURIComponent(setId)}`;
    try {
      const body = await this.http.json<PTCGIOEnvelope<PTCGIOSet>>(target, this.requestInit());
      return body?.data ?? null;
    } catch (err) {
      if (err instanceof NotFoundError) {
        this.logger?.warn({ source: this.name, target }, 'ptcgio.getSet.not_found');
        return null;
      }
      throw err;
    }
  }

  /**
   * Fetch a single full card. Returns `null` on 404 instead of
   * throwing.
   */
  async getCard(cardId: string): Promise<PTCGIOCard | null> {
    if (!cardId) return null;
    const target = `${this.basePath}/cards/${encodeURIComponent(cardId)}`;
    try {
      const body = await this.http.json<PTCGIOEnvelope<PTCGIOCard>>(target, this.requestInit());
      return body?.data ?? null;
    } catch (err) {
      if (err instanceof NotFoundError) {
        this.logger?.warn({ source: this.name, target }, 'ptcgio.getCard.not_found');
        return null;
      }
      throw err;
    }
  }

  // ------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------

  /**
   * Async-generator that walks a paginated endpoint until the
   * response's `count` is below `pageSize` (the last page).
   */
  private async *paginate<T>(
    path: string,
    extraQuery: Record<string, string> = {},
  ): AsyncGenerator<T[], void, void> {
    let page = 1;
    while (true) {
      const target = buildQueryUrl(path, {
        ...extraQuery,
        page: String(page),
        pageSize: String(PTCGIO_MAX_PAGE_SIZE),
      });
      const body = await this.http.json<PTCGIOListEnvelope<T>>(target, this.requestInit());
      const data = Array.isArray(body?.data) ? body.data : [];
      yield data;
      const count = typeof body?.count === 'number' ? body.count : data.length;
      if (count < PTCGIO_MAX_PAGE_SIZE) return;
      page += 1;
    }
  }

  /**
   * Build the per-request init carrying the optional `X-Api-Key`
   * header. The `RateLimitedClient` already injects `User-Agent` and
   * `Accept`.
   */
  private requestInit(): RequestInit | undefined {
    if (!this.apiKey) return undefined;
    return { headers: { 'X-Api-Key': this.apiKey } };
  }
}

/**
 * Convenience factory: build a `PTCGIOAdapter` from an optional
 * pre-configured client, defaulting to the conservative free-API
 * rate limit. Tests typically pass an injected `fetchImpl` via
 * `httpOverrides`. Production callers (seed-ingest) pass a fully
 * configured `RateLimitedClient` and an `apiKey`.
 */
export function createPTCGIOAdapter(options: {
  /** Pre-built client. When omitted a default one is constructed. */
  http?: RateLimitedClient;
  /** Used only when `http` is not provided. */
  httpOverrides?: Partial<ConstructorParameters<typeof RateLimitedClient>[0]>;
  context?: AdapterContext;
  basePath?: string;
  apiKey?: string;
}): PTCGIOAdapter {
  const http =
    options.http ??
    new RateLimitedClient({
      host: PTCGIO_HOST,
      requestsPerSecond: PTCGIO_DEFAULT_RPS,
      burst: PTCGIO_DEFAULT_BURST,
      ...(options.httpOverrides ?? {}),
    });
  const config: PTCGIOAdapterConfig = { http };
  if (options.context !== undefined) config.context = options.context;
  if (options.basePath !== undefined) config.basePath = options.basePath;
  if (options.apiKey !== undefined) config.apiKey = options.apiKey;
  return new PTCGIOAdapter(config);
}

/**
 * Append a query string to a path that may or may not already carry
 * `?…`. Encodes values per `URLSearchParams` rules. Exported for
 * tests; internal to the adapter otherwise.
 */
export function buildQueryUrl(path: string, params: Record<string, string>): string {
  const search = new URLSearchParams(params).toString();
  if (!search) return path;
  return path.includes('?') ? `${path}&${search}` : `${path}?${search}`;
}
