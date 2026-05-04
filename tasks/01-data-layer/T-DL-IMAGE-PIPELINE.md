# T-DL-IMAGE-PIPELINE — Image ingestion → R2 with WebP variants and provenance metadata

**Stage:** 01-data-layer
**Agent role:** data
**Effort:** L
**Status:** in_progress

---

## Hard dependencies

- T-DL-SOURCE-INTERFACES (`SourceAdapter`, `RateLimitedClient`,
  `AdapterError` discriminated union, `RawPrinting.imageSourceUrl`).

## Soft dependencies (already merged; consumed read-only)

- T-DL-SOURCE-TCGDEX-EN — emits `RawPrinting.imageSourceUrl`
  (`{card.image}/high.png` against `assets.tcgdex.net`).
- T-DL-SOURCE-PTCGIO — emits `card.images?.large ?? card.images?.small`
  (`images.pokemontcg.io`).
- T-DL-SOURCE-TCGDEX-JP — emits `{card.image}/high.png`
  (`assets.tcgdex.net/jp/...`).
- T-DL-SOURCE-POKEMONCARD-JP (bundled in T-DL-SOURCE-TCGDEX-JP) —
  emits `card.imageUrl` (`www.pokemon-card.com/assets/img/card/...`).
- T-DL-SOURCE-BULBAPEDIA — explicitly emits `imageSourceUrl: null`
  (CC-BY-NC-SA exclusion lives in the adapter; this task asserts on
  it as a defence-in-depth check).
- T-FN-DOCKER — local MinIO at `http://localhost:9000`, bucket
  `images`, root credentials `minio` / `miniominio`. The bucket is
  bootstrapped by `infra/docker-compose.yml` `minio-init` and is
  named `images` (NOT `binderly-images`).

## Required reading

- `PROJECT.md` § 2 (Brand & Legal — image re-host posture), § 7
  (Sources & Standardization), § 11 (Scanner Pipeline — the 245×342
  RGB tensor consumer constraint).
- `rules/01-data-layer.md` (the "No image hotlinking" rule and the
  RateLimitedClient mandate).
- `context/legal-and-brand.md` — per-source license posture; the
  re-host vs no-re-host call.
- `context/tcg-domain.md` § 5 (canonical keys we use for storage
  paths).
- `context/conventions.md` — TS / lint / commit / migration shape.
- `data-pipeline/README.md` — the package's pipeline composition
  diagram and rate-limit floors.
- `packages/db/src/schema/{cards,printings,sets}.ts` — existing
  image columns we extend, never re-define.
- `packages/db/src/migrations/{0002_catalog_tables,0003_catalog_rls}.sql`
  — RLS posture we mirror onto the new sidecar table.
- `infra/docker-compose.yml` + `infra/README.md` — local MinIO
  configuration.

## Goal

Catalog images are property of upstream rights-holders and must be
re-hosted on Cloudflare R2 (PROJECT.md § 2; `rules/01-data-layer.md`
"No image hotlinking"). This task implements the pipeline that turns
each `RawPrinting.imageSourceUrl` emitted by a source adapter into
(a) a set of WebP variants stored in R2 (locally: MinIO emulator,
bucket `images`) at deterministic, debug-friendly paths and (b) a
provenance row in a new `printing_image` sidecar table that records
SHA-256 checksums, byte sizes, source URL, license tag, and
transcoded-at timestamp for de-duplication, audit, and the
takedown / kill-switch flow.

The output is consumed by:

- **T-DL-SEED-INGEST** — calls `processImage(input)` for every
  resolved canonical printing that carries a non-null
  `imageSourceUrl`, then writes the chosen variant URLs back into
  `printing.image_small_url` / `printing.image_large_url`.
- **T-SC-EMBED-MODEL** (Phase 6) — reads the `large` / `original`
  WebP variants out of R2 to compute the on-device ANN embeddings.
  PROJECT.md § 11 specifies the on-device pipeline crops to a
  245×342 RGB tensor, so anything ≥ 1024px on the long edge gives
  the embedding job ample headroom (see § Variant Ladder below).

## Decisions (locked at elaboration time)

### Variant ladder

Four WebP variants per source image. The thumb / card / large
trio matches the suggested floor in the orchestrator brief; the
fourth tier (`original`) is a lossless WebP retained for the
scanner training pipeline and audit trail.

| Variant    | Max-side (px) | Quality   | Effort | Consumer                                                     |
| ---------- | ------------- | --------- | ------ | ------------------------------------------------------------ |
| `thumb`    | 256           | q=70      | 6      | Browse grids, mobile lists, missing-card heatmaps            |
| `card`     | 512           | q=80      | 6      | Card detail hero on web/mobile, share previews               |
| `large`    | 1024          | q=85      | 6      | Zoom view, scanner-image source for embeddings               |
| `original` | source size   | lossless  | 6      | Scanner training corpus (T-SC-EMBED-MODEL), audit, regrade   |

Notes:

- All variants emit `image/webp`. Originals are kept in **lossless**
  WebP (`{ lossless: true }`) so the embedding training pipeline
  does not have to round-trip a lossy artefact.
- `effort: 6` is sharp's balanced encode setting (default is 4; 6
  trades ~2× CPU for ~10–15% smaller files — worth it because we
  transcode once and serve forever).
- The `large` (1024px max-side) is the floor the scanner needs.
  PROJECT.md § 11's pipeline crops to 245×342 RGB on-device; we
  keep `large` ≥ 4× that linear size so re-sampling never shapes
  bilinear-on-bilinear.
- `thumb` is generated as a *cover-fit* downscale (sharp's default
  resize semantics — preserves aspect, no padding). Card aspect
  ratio (~5:7) means a 256px max-side thumb is roughly 183×256.

### Storage layout — deterministic-path scheme (not content-addressed)

```
{bucket}/printings/{set_canonical_key}/{variant_key}/{variant}.webp
```

Examples:

```
images/printings/en-swsh9/en-swsh9-018-holo/thumb.webp
images/printings/en-swsh9/en-swsh9-018-holo/card.webp
images/printings/en-swsh9/en-swsh9-018-holo/large.webp
images/printings/en-swsh9/en-swsh9-018-holo/original.webp
images/printings/jp-s9/jp-s9-018-holo/large.webp
```

Set-level images (logo / symbol) — out of scope for this task; if
needed later, they get the same shape under
`sets/{set_canonical_key}/{logo|symbol}.webp`.

**Justification**:

- **Stable**: `set_canonical_key` and `variant_key` are deterministic
  across re-ingestion (`tcg-domain.md` § 5). Re-running the pipeline
  for the same printing overwrites the same R2 keys instead of
  fragmenting cache state.
- **Discoverable**: `mc ls local/images/printings/en-swsh9/` lists
  every variant of a set without round-tripping through the DB.
  Pablo can sanity-check ingestion locally with one command.
- **Source-of-truth-friendly**: when a printing's primary-source
  image changes (TCGdex re-uploads a higher-res scan), the same
  R2 path gets the new bytes without a DB URL update — and the
  `printing_image.original_sha256` row records both old and new
  observations for audit.
- **Trivially URL-stable for the scanner**: T-SC-ANN-INDEX bundles a
  per-printing `(variant_key, large_url)` mapping; the path scheme
  above lets the index assemble the URL purely from
  `(bucket_url, variant_key)` without a DB join.

Content-addressed paths (`sha256/{aa}/{bb}/{rest}.webp`) were
considered and rejected for the primary scheme: they're great for
CDN cache-ability but force every UI path to round-trip through
the `printing_image` table to discover the URL — a worse hot-path
than letting the path itself encode the canonical key.

The `printing_image.original_sha256` column still gives us
content-addressed dedup *at write time* (see § De-duplication) and
lets us add a content-addressed mirror later if a CDN integration
needs it.

### Provenance schema — new `printing_image` sidecar table

A printing can be sourced from multiple adapters (TCGdex EN, PTCGIO,
TCGdex JP) and we want to record which sources we have images for,
not just the chosen one. A sidecar table is cleaner than widening
`printing` (which would double its column count and conflate "URL
the UI uses" with "audit trail").

The chosen-canonical variant URLs continue to live on `printing`
(`image_small_url` / `image_large_url`) — those are the hot path
for browse / set / card detail and need no extra join. The image
pipeline writes them when it processes the **primary-tier**
adapter's image and never overwrites with a lower-tier source.

Columns (final shape; see § Migration plan for SQL):

```
printing_image
  id                  uuid PK default gen_random_uuid()
  printing_id         uuid NOT NULL FK → printing(id) ON DELETE CASCADE
  source              text NOT NULL  -- e.g. 'tcgdex-en', 'ptcgio',
                                        'tcgdex-jp', 'pokemoncard-jp'
                                        (NEVER 'bulbapedia-en' — we
                                        do not persist Bulbapedia
                                        images).
  source_url          text NOT NULL  -- the upstream URL we fetched
  source_content_type text           -- as reported by upstream
                                        (image/png, image/jpeg, ...)
  original_sha256     text NOT NULL  -- hex sha256 of the raw bytes
  original_byte_size  integer NOT NULL
  variants            jsonb NOT NULL -- { "thumb": { "url", "sha256",
                                          "byte_size", "width",
                                          "height" }, "card": {...},
                                          "large": {...},
                                          "original": {...} }
  license             text NOT NULL  -- 'TCGDEX' | 'PTCGIO' |
                                        'POKEMON_CARD_JP'
                                        (CHECK constraint enumerates)
  transcoded_at       timestamptz NOT NULL DEFAULT now()
  created_at          timestamptz NOT NULL DEFAULT now()
  updated_at          timestamptz NOT NULL DEFAULT now()
  UNIQUE (source, original_sha256)   -- "have we transcoded these
                                        bytes from this source?"
```

Indexes:

- `printing_image_printing_id_idx` on `(printing_id)` — "all images
  of this printing".
- `printing_image_original_sha256_idx` on `(original_sha256)` —
  cross-source dedup discovery (rare but useful for ops audits).

`license` is enforced by a CHECK constraint enumerating the three
permitted tags. Bulbapedia is intentionally absent from the enum —
inserting a Bulbapedia source would fail at write time, defence in
depth on top of the adapter-level skip.

RLS posture (mirrors catalog tables): public-read,
service-role-write, defence-in-depth REVOKE/GRANT pattern from
`0003_catalog_rls.sql`. Ships in a separate
`0011_image_provenance_rls.sql` per the conventions.md "RLS policy
changes ship in their own migration" rule.

### Worker contract — `processImage(input)`

Pure-ish public function (depends on injected `http` / `storage` /
`dedup` / `logger` collaborators; no module-level state).

```ts
export interface ProcessImageInput {
  printing: {
    /** stable identifier; storage path keys off this. */
    variantKey: string;
    /** stable identifier of the parent set; storage path keys off this. */
    setCanonicalKey: string;
  };
  source: ImageSource;       // 'tcgdex-en' | 'ptcgio' | ... | 'bulbapedia-en'
  sourceUrl: string | null;  // RawPrinting.imageSourceUrl
  http: RateLimitedClient;   // pre-built per-host
  storage: ImageStorage;     // wrapper over @aws-sdk/client-s3
  dedup: ImageDedupResolver; // SHA-256 lookup against printing_image
  logger?: AdapterLogger;
  /** Override variant ladder (tests use a single 64px tier). */
  ladder?: ReadonlyArray<VariantSpec>;
}

export type ProcessedImageResult =
  | {
      ok: true;
      status: 'transcoded' | 'cached' | 'skipped_no_url' | 'skipped_excluded_source';
      provenance: PrintingImageRow | null; // null on the two skipped paths
      variants: ProcessedImageVariant[];   // empty on skipped paths
    }
  | { ok: false; error: ImagePipelineError };
```

Composition by T-DL-SEED-INGEST:

1. Resolver produces canonical printings.
2. For each printing with a non-null `imageSourceUrl`, the seed
   job calls `processImage(...)`.
3. On `ok && status in ('transcoded' | 'cached')`, the job sets
   `printing.image_small_url` / `image_large_url` to the variants'
   R2 URLs and upserts the `printing_image` row.
4. On `ok && status === 'skipped_excluded_source'` (Bulbapedia or
   any future excluded source), the job writes nothing.

### De-duplication

1. The processor downloads the source image bytes (RateLimitedClient
   handles retries + 4xx/5xx classification).
2. It SHA-256s the raw bytes (`createHash('sha256')` from
   `node:crypto`).
3. It calls `dedup.findExisting({ source, originalSha256 })`. The
   resolver runs:
   ```sql
   SELECT id, variants
   FROM printing_image
   WHERE source = $1 AND original_sha256 = $2
   LIMIT 1
   ```
4. **Hit** → return `{ ok: true, status: 'cached', provenance,
   variants: provenance.variants }`. No transcode, no upload.
5. **Miss** → transcode all four variants, upload each to R2,
   compute their per-variant sha256/byte_size, upsert
   `printing_image` (`ON CONFLICT (source, original_sha256) DO UPDATE
   SET variants = EXCLUDED.variants, updated_at = now()`).

Idempotency guarantee: re-running `processImage(...)` for the same
source bytes is a O(1) DB lookup that performs zero R2 work.

### Concurrency + rate limits

- **HTTP fetches** — every fetch goes through a `RateLimitedClient`
  pinned to the source's image host. The seed-ingest job constructs
  these clients (one per host) and passes them in. The image
  pipeline does NOT mint its own client. Per-host floors (matches
  `data-pipeline/README.md`):

  | Host                   | rps  | burst |
  | ---------------------- | ---- | ----- |
  | `assets.tcgdex.net`    | 10   | 5     |
  | `images.pokemontcg.io` | 5    | 3     |
  | `www.pokemon-card.com` | 1    | 1     |

- **Transcoding** — sharp is CPU-bound. Default concurrency is
  `Math.max(1, os.cpus().length - 1)`; configurable via
  `IMAGE_TRANSCODE_CONCURRENCY` env var. `p-limit` provides the
  bounded pool.

- **Storage uploads** — the S3 client manages its own connection
  pool; we let sharp's transcode pool be the bottleneck and stream
  uploads opportunistically.

### Library choices

- **`sharp`** for transcoding. Locked. libvips bindings, prebuilt
  binaries for darwin-arm64 and linux-x64/arm64 (Apple Silicon dev
  + Vercel/Fly serverless), supports streams, well-maintained,
  `image/webp` first-class.
- **`@aws-sdk/client-s3`** for R2. R2 is S3-API-compatible; the
  AWS SDK is the most-tested client surface and integrates cleanly
  with mocks for our storage tests. `aws4fetch` (smaller dep) was
  considered and rejected: lacks streaming upload ergonomics and
  the official mock libraries don't target it.
- **`p-limit`** for the transcode pool (5KB, single-purpose, the
  Node ecosystem standard).

All three are added to `data-pipeline/package.json` `dependencies`.

### Error model — `ImagePipelineError` discriminated union

Mirrors the `AdapterError` pattern in `interfaces/adapter.ts`:

```ts
type ImagePipelineErrorKind =
  | 'fetch'
  | 'transcode'
  | 'storage'
  | 'dedup'
  | 'invariant';

abstract class ImagePipelineError extends Error {
  abstract readonly kind: ImagePipelineErrorKind;
  readonly source: string;
  readonly target?: string;
  override readonly cause?: unknown;
}

class FetchError extends ImagePipelineError    { kind = 'fetch'; }
class TranscodeError extends ImagePipelineError { kind = 'transcode'; }
class StorageError extends ImagePipelineError   { kind = 'storage'; }
class DedupError extends ImagePipelineError     { kind = 'dedup'; }
class InvariantError extends ImagePipelineError { kind = 'invariant'; }
```

`FetchError` wraps the underlying `AdapterError` (preserves the
upstream `kind`: `rate_limit` / `not_found` / `transient` /
`permanent`) so the seed-ingest job can decide whether to retry,
skip, or fail fast.

### Per-source image-URL mapping

| Source            | Adapter file                                         | Image URL field on `RawPrinting`                                    | Image host                | License tag         | Persisted? |
| ----------------- | ---------------------------------------------------- | ------------------------------------------------------------------- | ------------------------- | ------------------- | ---------- |
| `tcgdex-en`       | `data-pipeline/src/adapters/tcgdex-en/transform.ts`  | `imageSourceUrl = card.image ? '${card.image}/high.png' : null`     | `assets.tcgdex.net`       | `TCGDEX`            | ✅          |
| `tcgdex-jp`       | `data-pipeline/src/adapters/tcgdex-jp/transform.ts`  | same shape (JP path prefix)                                         | `assets.tcgdex.net`       | `TCGDEX`            | ✅          |
| `ptcgio`          | `data-pipeline/src/adapters/ptcgio/transform.ts`     | `imageSourceUrl = card.images?.large ?? card.images?.small ?? null` | `images.pokemontcg.io`    | `PTCGIO`            | ✅          |
| `pokemoncard-jp`  | `data-pipeline/src/adapters/pokemoncard-jp/transform.ts` | `imageSourceUrl = card.imageUrl` (absolute URL)                 | `www.pokemon-card.com`    | `POKEMON_CARD_JP`   | ✅          |
| `bulbapedia-en`   | `data-pipeline/src/adapters/bulbapedia/transform.ts` | `imageSourceUrl: null` (always; CC-BY-NC-SA exclusion)              | n/a                       | n/a                 | ❌          |

Defence in depth: the processor explicitly returns
`skipped_excluded_source` when `source === 'bulbapedia-en'` *or*
`sourceUrl === null`. This is asserted in
`processor.test.ts`.

### Acceptance test fixtures

Tests synthesize tiny PNG/JPEG fixtures programmatically with sharp's
`{ create: { width, height, channels, background } }` API:

- `synthesizeFixture('happy-path-100x140.png')` — 100×140 white PNG
  → drives the happy-path: fetch → SHA-256 → transcode → upload
  → upsert.
- `synthesizeFixture('tiny-50x50.jpeg')` — 50×50 red JPEG → drives
  the JPEG-input path.

We do **not** commit any real upstream binary (legal posture +
repo size). Storage tests use a mock S3 client (`mockClient` from
`aws-sdk-client-mock`), not a live MinIO. A separate live-MinIO
smoke test (gated on `BINDERLY_IMAGE_PIPELINE_LIVE=1`) is provided
for human-runnable verification per the orchestrator brief.

### Migration plan

- `packages/db/src/migrations/0010_image_provenance.sql` — creates
  `printing_image` table, FK to `printing(id)`, indexes, the
  `(source, original_sha256)` UNIQUE constraint, and the `license`
  CHECK constraint.
- `packages/db/src/migrations/0011_image_provenance_rls.sql` —
  enables RLS, public-read policy, REVOKE/GRANT defence-in-depth
  pattern (mirrors `0003_catalog_rls.sql`).
- `packages/db/src/migrations/meta/_journal.json` — append two
  entries (idx 10, idx 11).
- `packages/db/src/migrations/meta/0010_snapshot.json` — full
  snapshot copied from `0008_snapshot.json` plus the new
  `public.printing_image` table block. (No 0009 / 0011 snapshots —
  RLS-only migrations skip snapshot updates per the prior pattern.)
- `packages/db/src/schema/printing_image.ts` — Drizzle schema for
  the new table.
- `packages/db/src/schema/index.ts` — append a new export at the
  end (NOT inside any pre-staged section); no other in-flight task
  is touching this barrel.

## Deliverables

### Source code (`data-pipeline/src/images/`)

- `types.ts` — `ImageSource`, `VariantSpec`, `VARIANT_LADDER`,
  `ProcessedImageVariant`, `ProcessedImageResult`,
  `ImagePipelineError` discriminated union, `PrintingImageRow`.
- `transcoder.ts` — sharp wrapper. `transcode(buffer, ladder) →
  Promise<TranscodeOutput[]>`. Pure (modulo CPU and the sharp
  binary). Magic-byte check on output.
- `storage.ts` — `ImageStorage` interface + concrete
  `S3ImageStorage` over `@aws-sdk/client-s3`. Methods:
  `put({ key, body, contentType })`, `head({ key })`,
  `urlFor({ key })`, `keyFor({ setCanonicalKey, variantKey, variant })`.
- `dedup.ts` — `ImageDedupResolver` interface + `DrizzleDedupResolver`
  concrete impl that runs the upsert against `printing_image`.
- `processor.ts` — `processImage(input)` orchestration. Composes
  fetch → SHA-256 → dedup lookup → transcode → upload → upsert.
- `index.ts` — public barrel.

### Tests (colocated)

- `transcoder.test.ts` — happy path (PNG → 4 WebP variants), magic
  byte check (`RIFF....WEBP`), variant dimensions, lossless on
  `original`.
- `storage.test.ts` — `keyFor` deterministic key shape;
  `S3ImageStorage` interactions via `aws-sdk-client-mock`.
- `dedup.test.ts` — hit returns provenance, miss returns null,
  upsert SQL shape.
- `processor.test.ts` — happy path, cached path, skipped_no_url,
  skipped_excluded_source (Bulbapedia), FetchError propagation,
  TranscodeError on a corrupt input, StorageError on a put failure.

### DB

- `packages/db/src/schema/printing_image.ts`
- `packages/db/src/schema/index.ts` (append export at end)
- `packages/db/src/migrations/0010_image_provenance.sql`
- `packages/db/src/migrations/0011_image_provenance_rls.sql`
- `packages/db/src/migrations/meta/_journal.json` (append idx 10, 11)
- `packages/db/src/migrations/meta/0010_snapshot.json` (new)

### Infra docs

- `infra/r2/README.md` — bucket layout, key shape, local MinIO
  smoke test snippet, prod migration pointer to `T-DP-R2-PROD`.

### Package wiring

- `data-pipeline/package.json` — `sharp`, `@aws-sdk/client-s3`,
  `p-limit` dependencies (with one-line PR-body justifications).
- `data-pipeline/src/index.ts` — re-export the new `./images/index.js`
  surface.
- `pnpm-lock.yaml` — locked transitively.

## Acceptance criteria

- [ ] `processImage(input)` returns `{ ok: true, status:
      'transcoded', provenance, variants }` for the synthesized
      PNG happy-path fixture, with all four variants present and
      each variant's body passing the WebP magic-byte check
      (`bytes[0..4] === 'RIFF' && bytes[8..12] === 'WEBP'`).
- [ ] Re-running `processImage(input)` with the same source bytes
      returns `{ ok: true, status: 'cached', provenance, variants }`
      without invoking the transcoder or the storage `put` (asserted
      via mock-call counts).
- [ ] `processImage({ ..., sourceUrl: null })` returns `{ ok: true,
      status: 'skipped_no_url', provenance: null, variants: [] }`
      with zero HTTP / transcode / storage interactions.
- [ ] `processImage({ ..., source: 'bulbapedia-en', sourceUrl: '<url>' })`
      returns `{ ok: true, status: 'skipped_excluded_source' }` —
      defence-in-depth on top of the adapter-level
      `imageSourceUrl: null`.
- [ ] Variant ladder generates exactly the four documented sizes
      (`thumb` ≤256, `card` ≤512, `large` ≤1024, `original` =
      source size); each variant carries `width`, `height`,
      `byte_size`, `sha256`.
- [ ] Storage path follows the documented shape
      `printings/{set_canonical_key}/{variant_key}/{variant}.webp`
      (asserted in `storage.test.ts` and `processor.test.ts`).
- [ ] `printing_image.license` is `TCGDEX` | `PTCGIO` |
      `POKEMON_CARD_JP` per the source mapping table; processor
      refuses to insert any other value (asserted on a fixture).
- [ ] DB migration `0010_image_provenance.sql` applies cleanly on
      a fresh schema (skipped if Docker socket access is
      unavailable in sandbox; documented as a paste-able smoke
      test in the PR body — see § Escalation triggers).
- [ ] `pnpm --filter @binderly/data-pipeline test typecheck lint
      format:check build` is clean.
- [ ] No file modified outside the documented owns_paths +
      exceptions:
      - owns_paths: `data-pipeline/src/images/`, `infra/r2/`
      - documented exceptions:
        - `packages/db/src/schema/printing_image.ts` (new file)
        - `packages/db/src/schema/index.ts` (append-only at end)
        - `packages/db/src/migrations/0010_image_provenance.sql`
        - `packages/db/src/migrations/0011_image_provenance_rls.sql`
        - `packages/db/src/migrations/meta/_journal.json`
        - `packages/db/src/migrations/meta/0010_snapshot.json`
        - `packages/db/package.json` (no new deps unless documented)
        - `data-pipeline/package.json` (sharp, @aws-sdk/client-s3,
          p-limit)
        - `data-pipeline/src/index.ts` (barrel re-export)
        - `pnpm-lock.yaml`
        - `tasks/01-data-layer/T-DL-IMAGE-PIPELINE.md` (this file)

## Out of scope

- Set-level images (logo, symbol). Out of scope; the same path
  scheme will apply when added later.
- User-uploaded photos (`collection_item.photo_urls`). Lives under
  Supabase Storage with strict RLS, NOT in the catalog R2 bucket.
- Public CDN front in front of R2 / signed-URL generation. Lives
  in Phase 11 (`T-DP-R2-PROD`).
- Set / card / printing image-fallback UI. Lives in the web/mobile
  card-detail tasks.
- Bulbapedia image scraping. Explicitly forbidden (CC-BY-NC-SA);
  adapter excludes, pipeline asserts.
- TCGplayer / Cardmarket card images. Forbidden by
  `legal-and-brand.md`; not consumed by any adapter.

## Branch & PR

- Branch: `agent/T-DL-IMAGE-PIPELINE`
- PR title: `T-DL-IMAGE-PIPELINE: Image ingestion → R2 with WebP
  variants and provenance metadata`
- Commit format: Conventional Commits.

## Escalation triggers

Stop and surface to `open-questions.md` if any of the following hits:

- The scanner / embedding model needs an input larger than 1024px
  on the long edge (would require a fifth tier above `large`).
  Currently PROJECT.md § 11 says 245×342, so this is unblocked —
  surfaces only if T-SC-EMBED-MODEL revises the spec.
- License posture is unclear for a source we plan to persist (e.g.
  PTCGIO redistribution rights — the current read of their ToS is
  "permits commercial use, attribution recommended", but if it
  turns out commercial *redistribution* requires explicit
  permission, we'd need to switch to a hot-link-with-cache posture).
- DB schema would need a constraint on `printing` itself (we are
  intentionally NOT touching `printing` columns in this task —
  the existing `image_small_url` / `image_large_url` / `image_source_url`
  columns are sufficient).
- Docker / MinIO is unreachable from the sandbox and the
  end-to-end smoke can't be executed: ship the unit tests (mocked
  S3 client) and provide a paste-able human-runnable smoke test in
  the PR body, modeled on the T-FN-DB-MIGRATIONS pattern.

## Notes for downstream consumers

### For T-DL-SEED-INGEST

- Construct one `RateLimitedClient` per image host
  (`assets.tcgdex.net`, `images.pokemontcg.io`,
  `www.pokemon-card.com`) and one `S3ImageStorage` (parameterized
  via env: `S3_ENDPOINT_URL`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY`).
- Call `processImage({ printing, source, sourceUrl, http,
  storage, dedup, logger })` for every canonical printing where
  `imageSourceUrl != null` and `source` is not in the excluded set.
- On `{ ok: true, status: 'transcoded' | 'cached' }`, write
  `printing.image_small_url = variants.thumb.url` and
  `printing.image_large_url = variants.large.url` (the chosen
  small/large mapping is part of the printing-write contract; do
  NOT widen `printing` to expose `card` and `original` URLs).

### For T-SC-EMBED-MODEL

- Read `large` (or `original` if you need lossless) from the URL in
  `printing_image.variants.large.url` /
  `printing_image.variants.original.url`. Both are stable;
  `large` is a lossy WebP at q=85 with 1024px max-side (≥ 4× the
  on-device 245×342 RGB target), `original` is lossless WebP for
  training-time augmentation.
- The `printing_image.original_sha256` column doubles as the
  embedding-cache key: if it doesn't change between runs, the
  embedding can be reused.

## Notes from execution

_(Sub-agent appends here at end. Empty until then.)_
