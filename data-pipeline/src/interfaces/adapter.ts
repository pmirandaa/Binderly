// `SourceAdapter` — the contract every source implementation honors.
//
// One adapter per (source, language) pair. The adapter knows how to
// list sets, list cards within a set, and list printings within a
// card; it emits Raw* shapes (see `../types.ts`) and never assigns
// `variant_class` itself (the central classifier owns that — see
// `rules/01-data-layer.md`).
//
// Adapters MUST go through `RateLimitedClient` for any external HTTP
// call. They MUST NOT touch `globalThis.fetch` directly; the client
// enforces rate limits, retries, the User-Agent contract, and
// observability.

import type { AdapterTier, Language, RawCard, RawPrinting, RawSet } from '../types.js';

/**
 * Context passed to adapters at construction. Holds shared
 * infrastructure that adapters need but should not own (logger,
 * environment-derived constants).
 *
 * Concrete shape kept minimal here so downstream adapter tasks can
 * extend it. The seed-ingest task will provide the concrete impl.
 */
export interface AdapterContext {
  /** Pino-compatible logger; structured fields preferred. */
  readonly logger: AdapterLogger;
  /** Sandbox / production marker for log enrichment and feature flags. */
  readonly env?: 'development' | 'staging' | 'production' | 'test';
}

/**
 * The minimum log surface an adapter expects. Pino's `Logger` type
 * implements this trivially; tests stub it with a no-op object. We
 * don't import pino's full types here so non-pino loggers (a noop, a
 * console wrapper) remain valid implementations.
 */
export interface AdapterLogger {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  debug?: (obj: unknown, msg?: string) => void;
}

/**
 * The contract every source adapter implements. The interface is
 * intentionally narrow:
 *
 *   - `listSets()` returns every set this adapter knows about (it does
 *     not need to be paginated by the caller — adapters internally
 *     iterate pages and return the full array).
 *   - `listCardsForSet(setKey)` returns every card in the named set,
 *     using THE ADAPTER'S OWN set key (whatever the source uses; e.g.
 *     `swsh9`, `Brilliant Stars`, the source's UUID, etc.). The adapter
 *     emits the canonical set code on the `RawCard.setCode` field.
 *   - `listPrintingsForCard(cardKey)` returns every printing for the
 *     given card, using THE ADAPTER'S OWN card key.
 *
 * The resolver is responsible for calling these in the right order
 * (sets, then cards, then printings) and joining across adapters via
 * the canonical-key helpers.
 */
export interface SourceAdapter {
  /** Stable identifier, e.g. `tcgdex-en`, `ptcgio`, `bulbapedia-en`. */
  readonly name: string;
  /** Primary language this adapter is responsible for. */
  readonly language: Language;
  /** Resolver tier: `primary` wins, `validation` cross-checks, `filler` fills. */
  readonly tier: AdapterTier;
  /**
   * Optional set of fields (canonical names from the resolver merge
   * registry, e.g. `set.releaseDate`) for which this adapter is
   * authoritative. Filler-tier adapters can claim fields the primary
   * doesn't carry; validation-tier adapters can claim fields they want
   * to be the tiebreaker on. Empty / missing means "no claims".
   */
  readonly authoritativeFields?: ReadonlyArray<string>;

  listSets(): Promise<RawSet[]>;
  listCardsForSet(setKey: string): Promise<RawCard[]>;
  listPrintingsForCard(cardKey: string): Promise<RawPrinting[]>;
}

// ============================================================
// Adapter errors
// ============================================================

/**
 * `AdapterError` — discriminated union by `kind`. Adapters and the
 * HTTP client throw concrete subclasses; downstream handlers
 * `instanceof`-check the subclass and may surface to ops, retry, or
 * fail-fast based on policy.
 *
 * The `kind` discriminator lets pure (non-throwing) handlers narrow
 * without `instanceof`.
 */
export type AdapterErrorKind = 'rate_limit' | 'not_found' | 'transient' | 'permanent';

export interface AdapterErrorContext {
  /** Adapter name or `RateLimitedClient` host that raised the error. */
  source: string;
  /** Best-effort URL or canonical key the request targeted. */
  target?: string;
  /** Underlying cause if any (transport error, parse failure, …). */
  cause?: unknown;
}

/**
 * Base class. Carries the `kind` discriminator so consumers can narrow
 * the union without `instanceof` chains.
 */
export abstract class AdapterError extends Error {
  abstract readonly kind: AdapterErrorKind;
  readonly source: string;
  readonly target?: string;
  override readonly cause?: unknown;

  constructor(message: string, ctx: AdapterErrorContext) {
    super(message);
    this.name = new.target.name;
    this.source = ctx.source;
    this.target = ctx.target;
    this.cause = ctx.cause;
  }
}

/**
 * 429 from the upstream (or pre-emptively rate-limited locally). The
 * `retryAfterMs` carries the Retry-After header value (in ms) when
 * the upstream provided one; the HTTP client uses it for the next
 * attempt.
 */
export class RateLimitError extends AdapterError {
  override readonly kind = 'rate_limit' as const;
  readonly retryAfterMs?: number;

  constructor(message: string, ctx: AdapterErrorContext & { retryAfterMs?: number }) {
    super(message, ctx);
    this.retryAfterMs = ctx.retryAfterMs;
  }
}

/**
 * 404 from the upstream, or the resource definitively does not exist.
 * Downstream handling: skip, do not retry. Surfaced to the resolver as
 * "this adapter has no data for this entity" rather than an error.
 */
export class NotFoundError extends AdapterError {
  override readonly kind = 'not_found' as const;
}

/**
 * Network-level or 5xx error that may resolve on retry. The HTTP
 * client retries automatically per its policy; this class is what
 * surfaces when retries are exhausted.
 */
export class TransientError extends AdapterError {
  override readonly kind = 'transient' as const;
  readonly statusCode?: number;
  readonly attempt?: number;

  constructor(
    message: string,
    ctx: AdapterErrorContext & { statusCode?: number; attempt?: number },
  ) {
    super(message, ctx);
    this.statusCode = ctx.statusCode;
    this.attempt = ctx.attempt;
  }
}

/**
 * 4xx (other than 429) or a parse / contract error. Permanent — do not
 * retry. Almost always a bug in the adapter or a contract change at
 * the source.
 */
export class PermanentError extends AdapterError {
  override readonly kind = 'permanent' as const;
  readonly statusCode?: number;

  constructor(message: string, ctx: AdapterErrorContext & { statusCode?: number }) {
    super(message, ctx);
    this.statusCode = ctx.statusCode;
  }
}

/**
 * Type-guard for the union — useful for downstream handlers that
 * receive `unknown` from a `catch`.
 */
export function isAdapterError(value: unknown): value is AdapterError {
  return value instanceof AdapterError;
}
