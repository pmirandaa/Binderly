# Cloudflare R2 (image catalog)

The image pipeline (`@binderly/data-pipeline` →
`data-pipeline/src/images/`) writes WebP variants for every
re-hosted catalog image into R2. Production R2 buckets are
provisioned by `T-DP-R2-PROD` (Phase 11); local development uses
the MinIO emulator brought up by `infra/docker-compose.yml`.

This README is the source of truth for the **bucket layout**, the
**path scheme**, and the **smoke-test recipe** any sub-agent or
human can run to validate a round-trip end-to-end.

---

## Bucket layout

| Bucket          | Purpose                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------- |
| `images`        | Catalog card images (this pipeline). Public-read in prod via the R2 public bucket setting.  |
| `models`        | TFLite embedding / grading model artefacts (T-SC-EMBED-MODEL, T-GR-MODELS).                 |
| `ann`           | Per-language ANN index binaries (T-SC-ANN-INDEX).                                           |
| `user-uploads`  | Out of scope here; lives in Supabase Storage with strict RLS. Listed for completeness only. |

Local dev creates all four via `infra/docker-compose.yml`'s
`minio-init` one-shot service. See `infra/README.md` for the
console URLs and credentials.

---

## Path scheme

All keys for catalog card images follow:

```
printings/{set_canonical_key}/{variant_key}/{variant}.webp
```

Where:

- `set_canonical_key` — `{language}-{code}`, e.g. `en-swsh9`,
  `jp-s9`. Matches `set.canonical_key` in the catalog DB.
- `variant_key` — `{card.canonical_key}-{variant_code}`, e.g.
  `en-swsh9-018-holo`. Matches `printing.variant_key`.
- `variant` — one of `thumb` (≤256px), `card` (≤512px), `large`
  (≤1024px), `original` (lossless, source size).

Example keys:

```
printings/en-swsh9/en-swsh9-018-holo/thumb.webp
printings/en-swsh9/en-swsh9-018-holo/card.webp
printings/en-swsh9/en-swsh9-018-holo/large.webp
printings/en-swsh9/en-swsh9-018-holo/original.webp
printings/jp-s9/jp-s9-018-holo/large.webp
```

The shape is **deterministic** (re-running the pipeline overwrites
the same keys) and **debuggable** (`mc ls local/images/printings/en-swsh9/`
lists all variants of a set without round-tripping through Postgres).

Set-level images (logo, symbol) — out of scope for this pipeline;
when added later they will follow `sets/{set_canonical_key}/{logo|symbol}.webp`.

---

## Local smoke test (paste-able)

Verifies a real round-trip against MinIO + the local Postgres.
Requires Docker. From the repo root:

```bash
# 1. Bring up the local stack (Postgres + MinIO + Mailpit).
docker compose -f infra/docker-compose.yml up -d

# 2. Apply migrations.
DATABASE_URL=postgresql://binderly:binderly@localhost:5433/binderly \
  pnpm --filter @binderly/db db:migrate

# 3. Confirm the bucket is there.
docker compose -f infra/docker-compose.yml run --rm minio-init \
  /bin/sh -c 'mc alias set local http://minio:9000 minio miniominio && mc ls local/images'

# 4. Run a one-shot script that calls processImage() against a
#    synthetic PNG, writes 4 WebP variants to MinIO, and prints the
#    upserted printing_image row.
cat <<'TS' > /tmp/binderly-image-smoke.mjs
import { S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import {
  processImage,
  S3ImageStorage,
  InMemoryDedupResolver,
  RateLimitedClient,
} from '@binderly/data-pipeline';

const png = await sharp({
  create: { width: 800, height: 1120, channels: 4, background: { r: 0, g: 100, b: 200, alpha: 1 } },
}).png().toBuffer();

const http = new RateLimitedClient({
  host: 'localhost',
  requestsPerSecond: 10,
  burst: 5,
  userAgent: 'Binderly/0.1 (smoke test)',
  fetchImpl: async () => new Response(png, { headers: { 'content-type': 'image/png' } }),
});

const client = new S3Client({
  endpoint: 'http://localhost:9000',
  region: 'us-east-1',
  forcePathStyle: true,
  credentials: { accessKeyId: 'minio', secretAccessKey: 'miniominio' },
});
const storage = new S3ImageStorage({
  bucket: 'images',
  publicUrlPrefix: 'http://localhost:9000/images',
  client,
});

const result = await processImage({
  printing: { variantKey: 'en-swsh9-018-holo', setCanonicalKey: 'en-swsh9' },
  source: 'tcgdex-en',
  sourceUrl: 'http://localhost/fake.png',
  http,
  storage,
  dedup: new InMemoryDedupResolver(),
});

console.log(JSON.stringify(result, null, 2));
TS

node --experimental-vm-modules /tmp/binderly-image-smoke.mjs

# 5. List the 4 variants we just wrote.
docker compose -f infra/docker-compose.yml run --rm minio-init \
  /bin/sh -c 'mc alias set local http://minio:9000 minio miniominio && \
              mc ls --recursive local/images/printings/en-swsh9'
```

The smoke test exercises the full pipeline (fetch shim → sha256 →
transcode → upload → upsert) but uses the `InMemoryDedupResolver`
because the production resolver wiring (Drizzle) ships in
T-DL-SEED-INGEST.

---

## Production migration (T-DP-R2-PROD)

Phase 11 wires the R2 buckets, public bucket settings, IAM keys,
and bucket-policy review. The data-pipeline code in this task is
endpoint-agnostic — production deploys pass a real R2 endpoint
URL, an R2 access key pair, and the production bucket name to
`S3ImageStorage`'s constructor; nothing else changes.
