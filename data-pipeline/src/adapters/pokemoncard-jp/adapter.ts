// `PokemonCardJpAdapter` — filler tier for the Japanese catalog.
//
// Polite scraper of the official Pokémon Japan card DB
// (https://www.pokemon-card.com/). Per PROJECT.md § 7 the site is
// authorized as a fallback for TCGdex JP coverage gaps; per
// PROJECT.md § 18 it's a known data-layer risk we close by shipping
// this adapter.
//
// Endpoints hit (full mapping in
// `tasks/01-data-layer/T-DL-SOURCE-TCGDEX-JP.md`):
//
//   - /card-search/index.php?regulation_sidebar_form={SET_PCJP_ID}
//        → expansion landing page (parsed to RawSet + a list of
//          per-card URLs).
//   - /card-search/details.php?id={CARD_PCJP_ID}
//        → single card detail page.
//
// Rate limits and User-Agent are strict. The adapter ships with
// `1 rps` sustained / `burst: 1` defaults; the constructor accepts
// an existing client whose rate limits the caller controls.
//
// Error policy:
//   - Single-resource fetches propagate `NotFoundError` so callers
//     can decide.
//   - List-shaped methods (`listSets`, `listCardsForSet`,
//     `listPrintingsForCard`) translate `NotFoundError` to `[]`.
//   - The Pokemon-Card.com "card not found" page returns HTTP 200
//     with a body lacking `<dl class="cardDataDetail">`; the
//     transform detects this and the adapter raises `NotFoundError`
//     for granular fetches / returns `[]` for list-shaped methods.

import {
  POKEMONCARD_JP_SOURCE,
  pokemonCardJpCardToPrintings,
  pokemonCardJpCardToRaw,
  pokemonCardJpHtmlToCard,
  pokemonCardJpHtmlToSet,
  pokemonCardJpSetToRaw,
} from './transform.js';
import { RateLimitedClient } from '../../http/rate-limited-client.js';
import {
  NotFoundError,
  type AdapterContext,
  type SourceAdapter,
} from '../../interfaces/adapter.js';

import type { PokemonCardJpCard, PokemonCardJpSet } from './api-types.js';
import type { AdapterTier, Language, RawCard, RawPrinting, RawSet } from '../../types.js';

export const POKEMONCARD_JP_HOST = 'www.pokemon-card.com' as const;
export const POKEMONCARD_JP_DEFAULT_BASE_URL = 'https://www.pokemon-card.com' as const;
/** Strict polite-scraper floor (per task spec). 1 rps sustained. */
export const POKEMONCARD_JP_DEFAULT_RPS = 1;
/** Strict polite-scraper floor: no burst headroom. */
export const POKEMONCARD_JP_DEFAULT_BURST = 1;
/** Mandatory operator-contactable User-Agent (per task brief). */
export const POKEMONCARD_JP_DEFAULT_UA =
  'binderly-data-pipeline/1.0 (+https://github.com/pmirandaa/Binderly)' as const;

/** Path to the expansion landing page (per task spec § Pokemon-Card.com URL shape). */
export const POKEMONCARD_JP_EXPANSION_PATH = '/card-search/index.php' as const;
/** Path to the single-card detail page. */
export const POKEMONCARD_JP_CARD_PATH = '/card-search/details.php' as const;

export interface PokemonCardJpAdapterConfig {
  http: RateLimitedClient;
  context?: AdapterContext;
}

export class PokemonCardJpAdapter implements SourceAdapter {
  readonly name = POKEMONCARD_JP_SOURCE;
  readonly language: Language = 'jp';
  readonly tier: AdapterTier = 'filler';

  /**
   * Filler-tier semantics: empty by default. The resolver only
   * consults this source for fields the primary leaves null.
   */
  readonly authoritativeFields: ReadonlyArray<string> = [];

  private readonly http: RateLimitedClient;
  private readonly logger: AdapterContext['logger'] | undefined;

  constructor(config: PokemonCardJpAdapterConfig) {
    if (!config.http) {
      throw new Error('PokemonCardJpAdapter: `http` (RateLimitedClient) is required');
    }
    if (config.http.host !== POKEMONCARD_JP_HOST) {
      throw new Error(
        `PokemonCardJpAdapter: RateLimitedClient must be pinned to ${POKEMONCARD_JP_HOST} (got ${config.http.host})`,
      );
    }
    this.http = config.http;
    this.logger = config.context?.logger;
  }

  // ------------------------------------------------------------
  // SourceAdapter
  // ------------------------------------------------------------

  /**
   * Pokemon-Card.com does not expose a structured set index at the
   * `/card-search/` root that we can deterministically enumerate
   * without hammering search endpoints. Per the elaborated spec,
   * downstream callers (T-DL-SEED-INGEST) supply the per-set
   * `pcjpSetId` list explicitly via `getSet(pcjpSetId)`. The
   * `listSets()` method is therefore a no-op (returns `[]`) on
   * this adapter; it satisfies the `SourceAdapter` interface
   * contract.
   */
  async listSets(): Promise<RawSet[]> {
    this.logger?.debug?.({ source: this.name }, 'pokemoncard-jp.listSets.noop');
    return [];
  }

  /**
   * Fetch an expansion page by Pokemon-Card.com integer set id.
   * Returns the parsed `RawSet` only; the per-card URLs need a
   * follow-up `getCard` call. We don't enumerate per-card listings
   * from the expansion page in this task — the seed-ingest layer
   * pages through cards directly via known IDs (gathered from a
   * one-time crawl of `/card-search/`).
   */
  async listCardsForSet(_setKey: string): Promise<RawCard[]> {
    this.logger?.debug?.(
      { source: this.name, target: _setKey },
      'pokemoncard-jp.listCardsForSet.noop',
    );
    return [];
  }

  /**
   * Fetch a single Pokemon-Card.com card page and emit its single
   * printing. Caller passes the `pcjpCardId` (the integer ID, as a
   * string).
   */
  async listPrintingsForCard(cardKey: string): Promise<RawPrinting[]> {
    if (!cardKey) return [];
    const card = await this.getCard(cardKey);
    if (!card) return [];
    return pokemonCardJpCardToPrintings(card);
  }

  // ------------------------------------------------------------
  // Granular fetches (used by seed-ingest)
  // ------------------------------------------------------------

  /**
   * Fetch and parse a single expansion page. Returns the parsed
   * Pokemon-Card.com set struct (NOT a `RawSet`) so callers can
   * pass it to `pokemonCardJpSetToRaw` / the matcher as needed.
   * Returns `null` on 404 or when the page lacks the expected
   * expansion header.
   */
  async getSet(pcjpSetId: string): Promise<PokemonCardJpSet | null> {
    if (!pcjpSetId) return null;
    const target = `${POKEMONCARD_JP_EXPANSION_PATH}?regulation_sidebar_form=${encodeURIComponent(pcjpSetId)}`;
    let html: string;
    try {
      html = await this.http.request(target).then((res) => res.text());
    } catch (err) {
      if (err instanceof NotFoundError) {
        this.logger?.warn({ source: this.name, target }, 'pokemoncard-jp.getSet.not_found');
        return null;
      }
      throw err;
    }
    const set = pokemonCardJpHtmlToSet(html, { pcjpSetId });
    if (!set) {
      this.logger?.warn({ source: this.name, target }, 'pokemoncard-jp.getSet.unparseable');
      return null;
    }
    return set;
  }

  /**
   * Fetch and parse a single card detail page. Returns the parsed
   * `PokemonCardJpCard` struct, or `null` on 404 / "card not found"
   * body.
   */
  async getCard(pcjpCardId: string): Promise<PokemonCardJpCard | null> {
    if (!pcjpCardId) return null;
    const target = `${POKEMONCARD_JP_CARD_PATH}?id=${encodeURIComponent(pcjpCardId)}`;
    let html: string;
    try {
      html = await this.http.request(target).then((res) => res.text());
    } catch (err) {
      if (err instanceof NotFoundError) {
        this.logger?.warn({ source: this.name, target }, 'pokemoncard-jp.getCard.not_found');
        return null;
      }
      throw err;
    }
    const card = pokemonCardJpHtmlToCard(html, { pcjpCardId });
    if (!card) {
      this.logger?.warn({ source: this.name, target }, 'pokemoncard-jp.getCard.not_found.body');
      return null;
    }
    return card;
  }

  // ------------------------------------------------------------
  // Convenience: parsed struct → RawSet / RawCard
  // ------------------------------------------------------------

  /**
   * Fetch a set via `getSet` and return the `RawSet` shape directly.
   * Returns `null` when the source has no data.
   */
  async getRawSet(pcjpSetId: string): Promise<RawSet | null> {
    const set = await this.getSet(pcjpSetId);
    return set ? pokemonCardJpSetToRaw(set) : null;
  }

  /**
   * Fetch a card via `getCard` and return the `RawCard` shape
   * directly. Returns `null` when the source has no data.
   */
  async getRawCard(pcjpCardId: string): Promise<RawCard | null> {
    const card = await this.getCard(pcjpCardId);
    return card ? pokemonCardJpCardToRaw(card) : null;
  }
}

/**
 * Convenience factory: build a `PokemonCardJpAdapter` from an
 * optional pre-configured client. Defaults to the strict polite-
 * scraper rate limits and the mandatory contactable User-Agent.
 *
 * Tests typically pass an injected `fetchImpl` via `httpOverrides`.
 * Production callers (seed-ingest) pass a fully configured
 * `RateLimitedClient`.
 */
export function createPokemonCardJpAdapter(options: {
  /** Pre-built client. When omitted a default one is constructed. */
  http?: RateLimitedClient;
  /** Used only when `http` is not provided. */
  httpOverrides?: Partial<ConstructorParameters<typeof RateLimitedClient>[0]>;
  context?: AdapterContext;
}): PokemonCardJpAdapter {
  const http =
    options.http ??
    new RateLimitedClient({
      host: POKEMONCARD_JP_HOST,
      requestsPerSecond: POKEMONCARD_JP_DEFAULT_RPS,
      burst: POKEMONCARD_JP_DEFAULT_BURST,
      userAgent: POKEMONCARD_JP_DEFAULT_UA,
      ...(options.httpOverrides ?? {}),
    });
  const config: PokemonCardJpAdapterConfig = { http };
  if (options.context !== undefined) config.context = options.context;
  return new PokemonCardJpAdapter(config);
}
