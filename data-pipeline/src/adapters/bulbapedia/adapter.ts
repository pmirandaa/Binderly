// `BulbapediaAdapter` — filler English source per PROJECT.md § 7.
//
// Wraps the `RateLimitedClient` and exposes the `SourceAdapter`
// surface. All HTTP goes through the client; the adapter never
// touches `globalThis.fetch` (per `rules/01-data-layer.md`).
//
// Endpoints hit (full mapping in the elaborated task spec):
//
//   - `/w/api.php?action=query&list=categorymembers&cmtitle=Category:<Set>&cmlimit=500&cmnamespace=0`
//     → enumerate page titles for cards in a set
//   - `/w/api.php?action=query&prop=revisions&rvprop=content&rvslots=main&titles=<Title>&formatversion=2`
//     → fetch a page's wikitext (set or card)
//
// Rate-limit posture: 1 req/s sustained, burst 2 (Bulbapedia is an
// unmonetized community wiki; conservative by design — see
// `context/legal-and-brand.md`). Retries / `Retry-After` /
// 4xx handling are owned by the `RateLimitedClient`.
//
// Error policy:
//   - List-shaped methods translate `NotFoundError` and the
//     MediaWiki `pages[0].missing === true` ("page does not exist")
//     to an empty array — the adapter has "no data" for that
//     entity.
//   - The granular `getSet(pageTitle)` / `getCard(pageTitle)`
//     methods return `null` on the same conditions; the resolver
//     dispatch wrapper consumes those.

import {
  bulbapediaWikitextToCard,
  bulbapediaWikitextToPrintings,
  bulbapediaWikitextToSet,
  BULBAPEDIA_EN_SOURCE,
} from './transform.js';
import { RateLimitedClient } from '../../http/rate-limited-client.js';
import {
  NotFoundError,
  PermanentError,
  type AdapterContext,
  type SourceAdapter,
} from '../../interfaces/adapter.js';

import type {
  MediaWikiCategoryMembersResponse,
  MediaWikiPage,
  MediaWikiQueryRevisionsResponse,
} from './wiki-types.js';
import type { AdapterTier, Language, RawCard, RawPrinting, RawSet } from '../../types.js';

export const BULBAPEDIA_HOST = 'bulbapedia.bulbagarden.net' as const;
export const BULBAPEDIA_DEFAULT_BASE_URL = 'https://bulbapedia.bulbagarden.net' as const;
/**
 * Bulbapedia mounts its MediaWiki API at `/w/api.php`. We carry the
 * `/w` portion as the `basePath` and append `api.php` per request.
 */
export const BULBAPEDIA_DEFAULT_BASE_PATH = '/w' as const;
/** Conservative free-API floor — see elaborated task spec §
 *  "Rate limit and User-Agent". */
export const BULBAPEDIA_DEFAULT_RPS = 1;
export const BULBAPEDIA_DEFAULT_BURST = 2;

export interface BulbapediaAdapterConfig {
  /** RateLimitedClient pinned to `bulbapedia.bulbagarden.net`. */
  http: RateLimitedClient;
  /**
   * Base path under the host. Defaults to `/w` (Bulbapedia mounts
   * the API at `/w/api.php`). Override only if Bulbapedia ever
   * relocates its API endpoint.
   */
  basePath?: string;
  /** Optional shared adapter context (logger, env). */
  context?: AdapterContext;
}

export class BulbapediaAdapter implements SourceAdapter {
  readonly name = BULBAPEDIA_EN_SOURCE;
  readonly language: Language = 'en';
  readonly tier: AdapterTier = 'filler';

  /**
   * Filler-tier sources don't claim authoritative fields by default;
   * the resolver only uses Bulbapedia output when the primary leaves
   * a slot null. Sibling adapter tasks may extend later.
   */
  readonly authoritativeFields: ReadonlyArray<string> = [];

  private readonly http: RateLimitedClient;
  private readonly basePath: string;
  private readonly logger: AdapterContext['logger'] | undefined;

  constructor(config: BulbapediaAdapterConfig) {
    if (!config.http) {
      throw new Error('BulbapediaAdapter: `http` (RateLimitedClient) is required');
    }
    if (config.http.host !== BULBAPEDIA_HOST) {
      throw new Error(
        `BulbapediaAdapter: RateLimitedClient must be pinned to ${BULBAPEDIA_HOST} (got ${config.http.host})`,
      );
    }
    this.http = config.http;
    this.basePath = (config.basePath ?? BULBAPEDIA_DEFAULT_BASE_PATH).replace(/\/$/, '');
    this.logger = config.context?.logger;
  }

  // ------------------------------------------------------------
  // SourceAdapter
  // ------------------------------------------------------------

  /**
   * `listSets()` is intentionally empty by default. Bulbapedia does
   * not have a single canonical "TCG expansions" category that
   * cleanly enumerates every set, and a filler-tier source isn't
   * expected to drive primary set discovery (the primary tier owns
   * that). The orchestrator can extend this method later by passing
   * an explicit list of set page titles via `getSet`. Until then we
   * surface zero sets and let the resolver continue.
   *
   * Returning `[]` is the documented contract for "no data" per
   * `data-pipeline/src/interfaces/adapter.ts`.
   */
  async listSets(): Promise<RawSet[]> {
    this.logger?.info(
      { source: this.name },
      'bulbapedia-en.listSets.empty (filler tier; primary owns enumeration)',
    );
    return [];
  }

  async listCardsForSet(setKey: string): Promise<RawCard[]> {
    if (!setKey) return [];
    const titles = await this.listCardTitlesInCategory(this.categoryFromSetKey(setKey));
    const cards: RawCard[] = [];
    for (const title of titles) {
      const card = await this.getCard(title);
      if (card) cards.push(card);
    }
    return cards;
  }

  async listPrintingsForCard(cardKey: string): Promise<RawPrinting[]> {
    if (!cardKey) return [];
    const fetched = await this.fetchRevision(cardKey);
    if (!fetched) return [];
    return bulbapediaWikitextToPrintings(fetched.title, fetched.content);
  }

  // ------------------------------------------------------------
  // Granular fetches (used by sibling tasks like seed-ingest)
  // ------------------------------------------------------------

  async getSet(pageTitle: string): Promise<RawSet | null> {
    if (!pageTitle) return null;
    const fetched = await this.fetchRevision(pageTitle);
    if (!fetched) return null;
    return bulbapediaWikitextToSet(fetched.title, fetched.content);
  }

  async getCard(pageTitle: string): Promise<RawCard | null> {
    if (!pageTitle) return null;
    const fetched = await this.fetchRevision(pageTitle);
    if (!fetched) return null;
    return bulbapediaWikitextToCard(fetched.title, fetched.content);
  }

  /**
   * Enumerate card page titles inside a Bulbapedia category. The
   * caller passes a category title with the `Category:` prefix (e.g.
   * `Category:Brilliant Stars`).
   */
  async listCardTitlesInCategory(categoryTitle: string): Promise<string[]> {
    if (!categoryTitle) return [];
    const titles: string[] = [];
    let cmcontinue: string | undefined;
    // Hard upper bound on continuations to defend against
    // pathological category cycles. Bulbapedia category sizes top
    // out at low thousands; 20 pages × 500 = 10k titles is more than
    // enough headroom and bounds wall-clock at ~10s at our 1 rps
    // floor.
    for (let page = 0; page < 20; page += 1) {
      const url = this.buildCategoryMembersUrl(categoryTitle, cmcontinue);
      let body: MediaWikiCategoryMembersResponse;
      try {
        body = await this.http.json<MediaWikiCategoryMembersResponse>(url);
      } catch (err) {
        if (err instanceof NotFoundError) {
          this.logger?.warn(
            { source: this.name, target: url },
            'bulbapedia-en.categorymembers.not_found',
          );
          return [];
        }
        throw err;
      }
      const members = body.query?.categorymembers ?? [];
      for (const m of members) {
        if (m.title) titles.push(m.title);
      }
      const next = body.continue?.cmcontinue;
      if (!next) break;
      cmcontinue = next;
    }
    return titles;
  }

  // ------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------

  private async fetchRevision(title: string): Promise<{ title: string; content: string } | null> {
    const url = this.buildRevisionsUrl(title);
    let body: MediaWikiQueryRevisionsResponse;
    try {
      body = await this.http.json<MediaWikiQueryRevisionsResponse>(url);
    } catch (err) {
      if (err instanceof NotFoundError) {
        this.logger?.warn({ source: this.name, target: url }, 'bulbapedia-en.revisions.not_found');
        return null;
      }
      throw err;
    }
    const pages = body.query?.pages;
    if (!pages || pages.length === 0) {
      // MediaWiki always returns a `query.pages` array under
      // formatversion=2; an empty body is a contract violation.
      throw new PermanentError(`bulbapedia-en: response missing query.pages array`, {
        source: this.name,
        target: url,
      });
    }
    const page = pages[0] as MediaWikiPage;
    if (page.missing === true || page.invalid === true) {
      this.logger?.warn(
        {
          source: this.name,
          target: url,
          missing: page.missing === true,
          invalid: page.invalid === true,
        },
        'bulbapedia-en.revisions.missing_or_invalid',
      );
      return null;
    }
    const content = page.revisions?.[0]?.slots?.main?.content ?? page.revisions?.[0]?.content ?? '';
    if (!content) {
      this.logger?.warn(
        { source: this.name, target: url, title: page.title },
        'bulbapedia-en.revisions.empty_content',
      );
      return null;
    }
    return { title: page.title, content };
  }

  /**
   * Convert a "set key" (the resolver's identifier for a Bulbapedia
   * set — typically the set page title `<Set Name> (TCG)`) into the
   * matching Bulbapedia category title. We strip the `(TCG)` suffix
   * and prepend `Category:`.
   */
  private categoryFromSetKey(setKey: string): string {
    const trimmed = setKey.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('Category:')) return trimmed;
    const stripped = trimmed.replace(/\s*\(TCG\)\s*$/i, '').trim();
    return `Category:${stripped}`;
  }

  private buildRevisionsUrl(title: string): string {
    const params = new URLSearchParams({
      action: 'query',
      prop: 'revisions',
      rvprop: 'content',
      rvslots: 'main',
      formatversion: '2',
      format: 'json',
      titles: title,
    });
    return `${this.basePath}/api.php?${params.toString()}`;
  }

  private buildCategoryMembersUrl(categoryTitle: string, cmcontinue?: string): string {
    const params = new URLSearchParams({
      action: 'query',
      list: 'categorymembers',
      cmtitle: categoryTitle,
      cmnamespace: '0',
      cmlimit: '500',
      formatversion: '2',
      format: 'json',
    });
    if (cmcontinue) params.set('cmcontinue', cmcontinue);
    return `${this.basePath}/api.php?${params.toString()}`;
  }
}

/**
 * Convenience factory: build a `BulbapediaAdapter` from an optional
 * pre-configured client, defaulting to the conservative free-API
 * rate limit. Tests typically pass an injected `fetchImpl` via
 * `httpOverrides`. Production callers (seed-ingest) pass a fully
 * configured `RateLimitedClient`.
 */
export function createBulbapediaAdapter(options: {
  /** Pre-built client. When omitted a default one is constructed. */
  http?: RateLimitedClient;
  /** Used only when `http` is not provided. */
  httpOverrides?: Partial<ConstructorParameters<typeof RateLimitedClient>[0]>;
  context?: AdapterContext;
  basePath?: string;
}): BulbapediaAdapter {
  const http =
    options.http ??
    new RateLimitedClient({
      host: BULBAPEDIA_HOST,
      requestsPerSecond: BULBAPEDIA_DEFAULT_RPS,
      burst: BULBAPEDIA_DEFAULT_BURST,
      ...(options.httpOverrides ?? {}),
    });
  const config: BulbapediaAdapterConfig = { http };
  if (options.context !== undefined) config.context = options.context;
  if (options.basePath !== undefined) config.basePath = options.basePath;
  return new BulbapediaAdapter(config);
}
