// `TCGdexEnAdapter` — primary English source per PROJECT.md § 7.
//
// Wraps the `RateLimitedClient` and exposes the `SourceAdapter`
// surface. All HTTP goes through the client; the adapter never
// touches `globalThis.fetch` (per `rules/01-data-layer.md`).
//
// Endpoints hit (full mapping in
// `tasks/01-data-layer/T-DL-SOURCE-TCGDEX-EN.md`):
//
//   - `/v2/en/sets`            → set briefs (id + name + cardCount)
//   - `/v2/en/sets/{setId}`    → full set with embedded card briefs
//   - `/v2/en/cards/{cardId}`  → full card (rarity, types, attacks,
//                                variants, variants_detailed, …)
//
// Rate-limit posture: 5 req/s sustained, burst 10 (per orchestrator
// guidance for free TCG APIs). Retries / `Retry-After` / 4xx handling
// are owned by the `RateLimitedClient`.
//
// Error policy:
//   - Single-resource fetches (`getSet`, `getCard`) propagate
//     `NotFoundError` so callers can decide.
//   - List-shaped methods (`listSets`, `listCardsForSet`,
//     `listPrintingsForCard`) translate `NotFoundError` to an empty
//     array — the adapter has "no data" for that entity. The
//     resolver surfaces this as a presence conflict if a sibling
//     source has data.

import {
  TCGDEX_EN_SOURCE,
  tcgdexCardToPrintings,
  tcgdexCardToRaw,
  tcgdexSetToRaw,
} from './transform.js';
import { RateLimitedClient } from '../../http/rate-limited-client.js';
import {
  NotFoundError,
  type AdapterContext,
  type SourceAdapter,
} from '../../interfaces/adapter.js';

import type { TCGdexCard, TCGdexSet, TCGdexSetBrief } from './api-types.js';
import type { AdapterTier, Language, RawCard, RawPrinting, RawSet } from '../../types.js';

export const TCGDEX_HOST = 'api.tcgdex.net' as const;
export const TCGDEX_DEFAULT_BASE_URL = 'https://api.tcgdex.net' as const;
export const TCGDEX_EN_BASE_PATH = '/v2/en' as const;
/**
 * TCGdex serves card images from a separate CDN host (`assets.tcgdex.net`).
 * The seed-ingest job wires a dedicated `RateLimitedClient` pinned to this
 * host for the image-pipeline fetch leg — the API client (pinned to
 * `TCGDEX_HOST`) refuses cross-host calls. See Q-005 in `open-questions.md`.
 */
export const TCGDEX_ASSETS_HOST = 'assets.tcgdex.net' as const;
/** Conservative free-API floor — see elaborated task spec. */
export const TCGDEX_DEFAULT_RPS = 5;
export const TCGDEX_DEFAULT_BURST = 10;

export interface TCGdexEnAdapterConfig {
  /** RateLimitedClient pinned to `api.tcgdex.net`. */
  http: RateLimitedClient;
  /**
   * Base path under the host. Defaults to `/v2/en`. Override in
   * tests that need to exercise an alternate prefix.
   */
  basePath?: string;
  /** Optional shared adapter context (logger, env). */
  context?: AdapterContext;
}

export class TCGdexEnAdapter implements SourceAdapter {
  readonly name = TCGDEX_EN_SOURCE;
  readonly language: Language = 'en';
  readonly tier: AdapterTier = 'primary';

  /**
   * Fields where TCGdex EN is the source of truth even when a
   * validation tier disagrees. Empty on purpose: the resolver's
   * default "primary wins" suffices, and sibling adapter tasks may
   * extend later.
   */
  readonly authoritativeFields: ReadonlyArray<string> = [];

  private readonly http: RateLimitedClient;
  private readonly basePath: string;
  private readonly logger: AdapterContext['logger'] | undefined;

  constructor(config: TCGdexEnAdapterConfig) {
    if (!config.http) {
      throw new Error('TCGdexEnAdapter: `http` (RateLimitedClient) is required');
    }
    if (config.http.host !== TCGDEX_HOST) {
      throw new Error(
        `TCGdexEnAdapter: RateLimitedClient must be pinned to ${TCGDEX_HOST} (got ${config.http.host})`,
      );
    }
    this.http = config.http;
    this.basePath = (config.basePath ?? TCGDEX_EN_BASE_PATH).replace(/\/$/, '');
    this.logger = config.context?.logger;
  }

  // ------------------------------------------------------------
  // SourceAdapter
  // ------------------------------------------------------------

  async listSets(): Promise<RawSet[]> {
    let briefs: TCGdexSetBrief[];
    try {
      briefs = await this.http.json<TCGdexSetBrief[]>(`${this.basePath}/sets`);
    } catch (err) {
      if (err instanceof NotFoundError) {
        this.logger?.warn(
          { source: this.name, target: `${this.basePath}/sets` },
          'tcgdex-en.listSets.empty',
        );
        return [];
      }
      throw err;
    }
    if (!Array.isArray(briefs)) {
      throw new Error(`tcgdex-en.listSets: expected array from /sets, got ${typeof briefs}`);
    }
    const sets: RawSet[] = [];
    for (const brief of briefs) {
      if (!brief?.id) continue;
      const full = await this.getSet(brief.id);
      if (full) sets.push(tcgdexSetToRaw(full));
    }
    return sets;
  }

  async listCardsForSet(setKey: string): Promise<RawCard[]> {
    if (!setKey) return [];
    const set = await this.getSet(setKey);
    if (!set) return [];
    const cards: RawCard[] = [];
    for (const brief of set.cards ?? []) {
      if (!brief?.id) continue;
      const full = await this.getCard(brief.id);
      if (full) cards.push(tcgdexCardToRaw(full));
    }
    return cards;
  }

  async listPrintingsForCard(cardKey: string): Promise<RawPrinting[]> {
    if (!cardKey) return [];
    const card = await this.getCard(cardKey);
    if (!card) return [];
    return tcgdexCardToPrintings(card);
  }

  // ------------------------------------------------------------
  // Granular fetches (used by sibling tasks like seed-ingest)
  // ------------------------------------------------------------

  /**
   * Fetch a single full set. Returns `null` on 404 instead of
   * throwing; surfaces all other adapter errors untouched.
   */
  async getSet(setId: string): Promise<TCGdexSet | null> {
    if (!setId) return null;
    const target = `${this.basePath}/sets/${encodeURIComponent(setId)}`;
    try {
      return await this.http.json<TCGdexSet>(target);
    } catch (err) {
      if (err instanceof NotFoundError) {
        this.logger?.warn({ source: this.name, target }, 'tcgdex-en.getSet.not_found');
        return null;
      }
      throw err;
    }
  }

  /**
   * Fetch a single full card. Returns `null` on 404 instead of
   * throwing.
   */
  async getCard(cardId: string): Promise<TCGdexCard | null> {
    if (!cardId) return null;
    const target = `${this.basePath}/cards/${encodeURIComponent(cardId)}`;
    try {
      return await this.http.json<TCGdexCard>(target);
    } catch (err) {
      if (err instanceof NotFoundError) {
        this.logger?.warn({ source: this.name, target }, 'tcgdex-en.getCard.not_found');
        return null;
      }
      throw err;
    }
  }
}

/**
 * Convenience factory: build a `TCGdexEnAdapter` from an optional
 * pre-configured client, defaulting to the conservative free-API
 * rate limit. Tests typically pass an injected `fetchImpl` via
 * `httpOverrides`. Production callers (seed-ingest) pass a fully
 * configured `RateLimitedClient`.
 */
export function createTCGdexEnAdapter(options: {
  /** Pre-built client. When omitted a default one is constructed. */
  http?: RateLimitedClient;
  /** Used only when `http` is not provided. */
  httpOverrides?: Partial<ConstructorParameters<typeof RateLimitedClient>[0]>;
  context?: AdapterContext;
  basePath?: string;
}): TCGdexEnAdapter {
  const http =
    options.http ??
    new RateLimitedClient({
      host: TCGDEX_HOST,
      requestsPerSecond: TCGDEX_DEFAULT_RPS,
      burst: TCGDEX_DEFAULT_BURST,
      ...(options.httpOverrides ?? {}),
    });
  const config: TCGdexEnAdapterConfig = { http };
  if (options.context !== undefined) config.context = options.context;
  if (options.basePath !== undefined) config.basePath = options.basePath;
  return new TCGdexEnAdapter(config);
}
