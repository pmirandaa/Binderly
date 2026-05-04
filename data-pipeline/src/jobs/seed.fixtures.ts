// Test fixtures for the seed-ingest job.
//
// `MockAdapter` is a hand-rolled `SourceAdapter` driven by static
// data — no HTTP, no network. Tests compose 1+ `MockAdapter`s into
// the seed-ingest pipeline and assert per-stage / end-to-end
// behaviour against the in-memory writer / dedup / storage.
//
// `MockImageStorage` records every PUT / HEAD against an in-memory
// map. It's the test-only counterpart to `S3ImageStorage`.
//
// `MockHttpProvider` returns a pre-built `RateLimitedClient` per
// source, with a programmable `FetchShim` per host. The shim returns
// the bytes the test wants the image pipeline to see.

import sharp from 'sharp';

import { RateLimitedClient } from '../http/rate-limited-client.js';
import {
  type HeadResult,
  type ImageStorage,
  type ImageSource,
  type PutOptions,
  type VariantSpec,
} from '../images/index.js';
import {
  type AdapterTier,
  type Language,
  type RawCard,
  type RawPrinting,
  type RawSet,
  type SourceAdapter,
} from '../index.js';

import type { ImageHttpProvider } from './seed/image-pipeline-runner.js';

// ============================================================
// Synthetic catalog
// ============================================================

export interface MockAdapterOptions {
  readonly name: string;
  readonly language: Language;
  readonly tier: AdapterTier;
  readonly sets?: ReadonlyArray<RawSet>;
  /** card-by-set-key. Key is the adapter's own `RawSet.sourceKey`. */
  readonly cardsBySet?: ReadonlyMap<string, ReadonlyArray<RawCard>>;
  /** printings by adapter card key (`RawCard.sourceKey`). */
  readonly printingsByCard?: ReadonlyMap<string, ReadonlyArray<RawPrinting>>;
  /** Throw on `listSets()`. Used by the failure-isolation test. */
  readonly throwOnListSets?: Error;
  /** Throw on listCardsForSet for the named adapter set keys. */
  readonly throwOnListCardsForSet?: ReadonlySet<string>;
  /** Throw on listPrintingsForCard for the named adapter card keys. */
  readonly throwOnListPrintingsForCard?: ReadonlySet<string>;
}

export class MockAdapter implements SourceAdapter {
  readonly name: string;
  readonly language: Language;
  readonly tier: AdapterTier;
  readonly authoritativeFields: ReadonlyArray<string> = [];
  readonly listSetsCalls: number = 0;

  private readonly sets: ReadonlyArray<RawSet>;
  private readonly cardsBySet: ReadonlyMap<string, ReadonlyArray<RawCard>>;
  private readonly printingsByCard: ReadonlyMap<string, ReadonlyArray<RawPrinting>>;
  private readonly throwOnListSets: Error | undefined;
  private readonly throwOnListCardsForSet: ReadonlySet<string>;
  private readonly throwOnListPrintingsForCard: ReadonlySet<string>;

  constructor(opts: MockAdapterOptions) {
    this.name = opts.name;
    this.language = opts.language;
    this.tier = opts.tier;
    this.sets = opts.sets ?? [];
    this.cardsBySet = opts.cardsBySet ?? new Map();
    this.printingsByCard = opts.printingsByCard ?? new Map();
    this.throwOnListSets = opts.throwOnListSets;
    this.throwOnListCardsForSet = opts.throwOnListCardsForSet ?? new Set();
    this.throwOnListPrintingsForCard = opts.throwOnListPrintingsForCard ?? new Set();
  }

  async listSets(): Promise<RawSet[]> {
    if (this.throwOnListSets) throw this.throwOnListSets;
    return [...this.sets];
  }

  async listCardsForSet(setKey: string): Promise<RawCard[]> {
    if (this.throwOnListCardsForSet.has(setKey)) {
      throw new Error(`MockAdapter(${this.name}).listCardsForSet(${setKey}): programmed throw`);
    }
    return [...(this.cardsBySet.get(setKey) ?? [])];
  }

  async listPrintingsForCard(cardKey: string): Promise<RawPrinting[]> {
    if (this.throwOnListPrintingsForCard.has(cardKey)) {
      throw new Error(
        `MockAdapter(${this.name}).listPrintingsForCard(${cardKey}): programmed throw`,
      );
    }
    return [...(this.printingsByCard.get(cardKey) ?? [])];
  }
}

// ============================================================
// Built-in fixture: 1 EN set + 1 JP set + 1 Bulbapedia set
// ============================================================

/**
 * A small but representative synthetic catalog spanning two
 * primaries and two non-primary tiers, with a Bulbapedia-tier raw
 * printing carrying an `imageSourceUrl` (which the pipeline must
 * skip via `EXCLUDED_IMAGE_SOURCES`).
 */
export interface SyntheticCatalog {
  readonly tcgdexEn: MockAdapter;
  readonly ptcgio: MockAdapter;
  readonly tcgdexJp: MockAdapter;
  readonly bulbapedia: MockAdapter;
}

export function buildSyntheticCatalog(): SyntheticCatalog {
  // ----- EN set: swsh9 ("Brilliant Stars"); 2 cards, 3 printings total -----
  const swsh9SetKey = 'swsh9';
  const swsh9Set: RawSet = {
    source: 'tcgdex-en',
    sourceKey: swsh9SetKey,
    code: 'swsh9',
    language: 'en',
    name: 'Brilliant Stars',
    series: 'Sword & Shield',
    releaseDate: '2022-02-25',
    printedTotal: 172,
    total: 186,
    logoUrl: 'https://images.example.com/sets/swsh9/logo.png',
    symbolUrl: 'https://images.example.com/sets/swsh9/symbol.png',
  };

  const charizardCard: RawCard = {
    source: 'tcgdex-en',
    sourceKey: 'swsh9-018',
    setCode: 'swsh9',
    language: 'en',
    number: '018',
    name: 'Charizard VSTAR',
    typeRaw: 'Fire',
    subtypeRaw: 'Pokemon',
    hp: 270,
    illustrator: '5ban Graphics',
    rarityRaw: 'Holo Rare VSTAR',
  };

  const charizardHolo: RawPrinting = {
    source: 'tcgdex-en',
    sourceKey: 'swsh9-018-holo',
    cardKey: 'swsh9-018',
    sourcePrintingLabel: 'Holo',
    rarityRaw: 'Holo Rare VSTAR',
    isHolo: true,
    imageSourceUrl: 'https://images.example.com/swsh9/018-holo.png',
  };

  const charizardRevHolo: RawPrinting = {
    source: 'tcgdex-en',
    sourceKey: 'swsh9-018-revholo',
    cardKey: 'swsh9-018',
    sourcePrintingLabel: 'Reverse Holo',
    rarityRaw: 'Holo Rare VSTAR',
    isReverseHolo: true,
    imageSourceUrl: 'https://images.example.com/swsh9/018-revholo.png',
  };

  // A second card with an error printing (default-excluded by master-set
  // engine) and a TG (Trainer Gallery) printing (default-included).
  const galladeCard: RawCard = {
    source: 'tcgdex-en',
    sourceKey: 'swsh9-tg26',
    setCode: 'swsh9',
    language: 'en',
    number: 'TG26',
    name: 'Gallade',
    typeRaw: 'Psychic',
    subtypeRaw: 'Pokemon',
    hp: 130,
    illustrator: 'kawayoo',
    rarityRaw: 'Trainer Gallery Holo Rare',
  };

  const galladeTg: RawPrinting = {
    source: 'tcgdex-en',
    sourceKey: 'swsh9-tg26-tg',
    cardKey: 'swsh9-tg26',
    sourcePrintingLabel: 'Trainer Gallery Holo',
    rarityRaw: 'Trainer Gallery Holo Rare',
    isTrainerGallery: true,
    imageSourceUrl: 'https://images.example.com/swsh9/tg26-tg.png',
  };

  // ----- PTCGIO validation: matches the EN set + Charizard at the field level
  const swsh9SetPtcgio: RawSet = {
    source: 'ptcgio',
    sourceKey: 'swsh9',
    code: 'swsh9',
    language: 'en',
    name: 'Brilliant Stars',
    series: 'Sword & Shield',
    releaseDate: '2022-02-25',
    printedTotal: 172,
    total: 186,
  };

  const charizardCardPtcgio: RawCard = {
    source: 'ptcgio',
    sourceKey: 'swsh9-018',
    setCode: 'swsh9',
    language: 'en',
    number: '018',
    name: 'Charizard VSTAR',
    typeRaw: 'Fire',
    hp: 270,
    illustrator: '5ban Graphics',
    rarityRaw: 'Rare Holo VSTAR',
  };

  // ----- JP set: s9 (one card, one printing) -----
  const jpSet: RawSet = {
    source: 'tcgdex-jp',
    sourceKey: 's9',
    code: 's9',
    language: 'jp',
    name: 'Star Birth',
    series: 'Sword & Shield',
    releaseDate: '2022-01-14',
    printedTotal: 100,
    total: 114,
    logoUrl: 'https://images.example.com/sets/s9/logo.png',
  };

  const jpCard: RawCard = {
    source: 'tcgdex-jp',
    sourceKey: 's9-040',
    setCode: 's9',
    language: 'jp',
    number: '040',
    name: 'Hisuian Zoroark VSTAR',
    typeRaw: 'Darkness',
    subtypeRaw: 'Pokemon',
    hp: 270,
    illustrator: '5ban Graphics',
    rarityRaw: 'Holo Rare VSTAR',
  };

  const jpPrinting: RawPrinting = {
    source: 'tcgdex-jp',
    sourceKey: 's9-040-holo',
    cardKey: 's9-040',
    sourcePrintingLabel: 'Holo',
    rarityRaw: 'Holo Rare VSTAR',
    isHolo: true,
    imageSourceUrl: 'https://images.example.com/s9/040-holo.png',
  };

  // ----- Bulbapedia: filler tier; emits a printing with an
  // imageSourceUrl that the image pipeline MUST skip per
  // EXCLUDED_IMAGE_SOURCES. -----
  const bulbapediaPrintingForCharizard: RawPrinting = {
    source: 'bulbapedia-en',
    sourceKey: 'bulb-charizard-vstar-018-holo',
    cardKey: 'swsh9-018',
    sourcePrintingLabel: 'Holo (from Bulbapedia)',
    rarityRaw: 'Holo Rare V',
    isHolo: true,
    // Pipeline should NEVER hit this URL.
    imageSourceUrl: 'https://archives.bulbagarden.net/example.png',
  };

  const tcgdexEn = new MockAdapter({
    name: 'tcgdex-en',
    language: 'en',
    tier: 'primary',
    sets: [swsh9Set],
    cardsBySet: new Map([[swsh9SetKey, [charizardCard, galladeCard]]]),
    printingsByCard: new Map([
      ['swsh9-018', [charizardHolo, charizardRevHolo]],
      ['swsh9-tg26', [galladeTg]],
    ]),
  });

  const ptcgio = new MockAdapter({
    name: 'ptcgio',
    language: 'en',
    tier: 'validation',
    sets: [swsh9SetPtcgio],
    cardsBySet: new Map([['swsh9', [charizardCardPtcgio]]]),
    printingsByCard: new Map(),
  });

  const tcgdexJp = new MockAdapter({
    name: 'tcgdex-jp',
    language: 'jp',
    tier: 'primary',
    sets: [jpSet],
    cardsBySet: new Map([['s9', [jpCard]]]),
    printingsByCard: new Map([['s9-040', [jpPrinting]]]),
  });

  const bulbapedia = new MockAdapter({
    name: 'bulbapedia-en',
    language: 'en',
    tier: 'filler',
    sets: [],
    cardsBySet: new Map(),
    printingsByCard: new Map([['swsh9-018', [bulbapediaPrintingForCharizard]]]),
  });

  return { tcgdexEn, ptcgio, tcgdexJp, bulbapedia };
}

// ============================================================
// MockImageStorage
// ============================================================

export interface MockImageStorageOptions {
  readonly publicUrlPrefix?: string;
}

/**
 * In-memory `ImageStorage`. Records every PUT in `objects`. `head`
 * returns `exists: true` when an object has been put.
 */
export class MockImageStorage implements ImageStorage {
  readonly objects: Map<string, { body: Buffer; contentType: string }> = new Map();
  readonly puts: Array<{ key: string; size: number }> = [];
  private readonly publicUrlPrefix: string;

  constructor(opts: MockImageStorageOptions = {}) {
    this.publicUrlPrefix = (opts.publicUrlPrefix ?? 'http://test/images').replace(/\/$/, '');
  }

  async put(opts: PutOptions): Promise<void> {
    this.objects.set(opts.key, { body: opts.body, contentType: opts.contentType });
    this.puts.push({ key: opts.key, size: opts.body.length });
  }

  async head(key: string): Promise<HeadResult> {
    const obj = this.objects.get(key);
    if (!obj) return { exists: false };
    return { exists: true, contentLength: obj.body.length };
  }

  urlFor(key: string): string {
    return `${this.publicUrlPrefix}/${key}`;
  }
}

// ============================================================
// MockHttpProvider — programmable per-host fetch shim
// ============================================================

interface ProgrammedResponse {
  readonly status: number;
  readonly body?: Buffer;
  readonly headers?: Record<string, string>;
}

export class MockHttpProvider implements ImageHttpProvider {
  private readonly clients = new Map<ImageSource, RateLimitedClient>();
  private readonly queues = new Map<ImageSource, ProgrammedResponse[]>();

  /** Last-resort default response for any source that wasn't programmed. */
  private readonly defaultResponse: ProgrammedResponse;

  constructor(defaultResponse?: ProgrammedResponse) {
    this.defaultResponse = defaultResponse ?? { status: 200, body: Buffer.alloc(0) };
  }

  /** Configure responses for a source (and build a client for it). */
  programSource(source: ImageSource, ...responses: ProgrammedResponse[]): this {
    const queue = this.queues.get(source) ?? [];
    queue.push(...responses);
    this.queues.set(source, queue);
    if (!this.clients.has(source)) {
      const queueRef = queue;
      const fetchImpl = async (): Promise<Response> => {
        const next = queueRef.shift() ?? this.defaultResponse;
        return new Response(next.body ?? Buffer.alloc(0), {
          status: next.status,
          headers: next.headers,
        });
      };
      // Host is pinned to `images.example.com` so the synthetic
      // catalog's `imageSourceUrl` values pass `RateLimitedClient`'s
      // host-validation check. The fetch shim ignores the URL
      // anyway — it returns whatever the test programmed.
      const client = new RateLimitedClient({
        host: 'images.example.com',
        requestsPerSecond: 1000,
        burst: 10,
        userAgent: 'BinderlyTest/0.0.1 (contact: test@binderly.app)',
        retries: { max: 0, baseDelayMs: 1, factor: 2 },
        timeout: 5_000,
        fetchImpl,
        sleep: () => Promise.resolve(),
      });
      this.clients.set(source, client);
    }
    return this;
  }

  /** Auto-program every persisted source with a synthetic PNG. */
  async programAllWithSyntheticPng(): Promise<this> {
    const png = await makePngBytes();
    for (const source of ['tcgdex-en', 'tcgdex-jp', 'ptcgio', 'pokemoncard-jp'] as ImageSource[]) {
      this.programSource(source, {
        status: 200,
        body: png,
        headers: { 'content-type': 'image/png' },
      });
    }
    return this;
  }

  forSource(source: ImageSource): RateLimitedClient | null {
    return this.clients.get(source) ?? null;
  }
}

// ============================================================
// Variant ladder for tests (single rung — fast, deterministic)
// ============================================================

export const TINY_TEST_LADDER: VariantSpec[] = [
  { name: 'thumb', maxSide: 64, quality: 70, effort: 4, lossless: false },
  { name: 'card', maxSide: 96, quality: 80, effort: 4, lossless: false },
];

// ============================================================
// Helpers
// ============================================================

/** Create a tiny PNG buffer for image-pipeline tests. */
export async function makePngBytes(width = 80, height = 112): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 200, g: 50, b: 50, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}
