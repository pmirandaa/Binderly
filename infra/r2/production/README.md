# Cloudflare R2 — production

Production counterpart to the local MinIO emulator (`infra/docker-compose.yml`)
and the bucket/path contract documented in `infra/r2/README.md`. This
directory is **docs + policy files only** — no live keys (per
`rules/11-deployment.md`: "Secrets live in platform secret managers only").

Scaffolding (Stage 11 / T-DP-R2-PROD): everything here is ready to paste into
the Cloudflare dashboard / `wrangler` the moment Pablo provisions the R2
account. The web app + image pipeline are already endpoint-agnostic (see
`infra/r2/README.md` § "Production migration").

---

## Bucket layout

Mirrors the local buckets created by `minio-init` (see `infra/r2/README.md`):

| Bucket          | Prod visibility | Purpose                                                                 |
| --------------- | --------------- | ----------------------------------------------------------------------- |
| `images`        | **Public-read** | Catalog card images (the image pipeline). Fronted by a custom domain.   |
| `models`        | Public-read     | TFLite embedding / grading model artefacts; fetched on-device + by Fly. |
| `ann`           | Public-read     | Per-language ANN index binaries; fetched on-device.                     |
| `user-uploads`  | **N/A on R2**   | User photos live in **Supabase Storage** (strict RLS) — NOT on R2 public. Listed for completeness only. |

> ⚠️ Per `rules/11-deployment.md`: "R2 public bucket misconfiguration leaking
> data — buckets for catalog images are public-read; user-uploaded photos are
> NOT." Never create a public R2 bucket for user uploads. Catalog
> (`images`/`models`/`ann`) is public content we re-host; user photos are
> private and stay in Supabase Storage.

### Path scheme (unchanged from local)

```
printings/{set_canonical_key}/{variant_key}/{variant}.webp
```

e.g. `printings/en-swsh9/en-swsh9-018-holo/card.webp`. Deterministic — the
pipeline overwrites the same keys on re-run.

---

## Public delivery + custom domain

The `images` bucket is served publicly via a **custom domain**
`images.binderly.app` (R2 → bucket → Settings → Public access → Connect
custom domain). That host is already:

- allow-listed in `apps/web/next.config.mjs` (`images.remotePatterns`), and
- the production value of `NEXT_PUBLIC_R2_PUBLIC_BASE_URL`
  (`https://images.binderly.app`) the web app reads.

Prefer a custom domain over the `*.r2.dev` dev URL: it gets Cloudflare CDN
caching + lets us attach the [`cors.json`](./cors.json) policy.

### Why CORS?

The OG image route fetches catalog thumbnails **server-side** (no CORS
needed there), but the browser-side `next/image` loader and any client-side
`fetch()` of an image URL are cross-origin (`binderly.app` →
`images.binderly.app`). [`cors.json`](./cors.json) allows `GET`/`HEAD` from
the web origins with `Range` support (for progressive image loads).

Apply:

```bash
# wrangler (recommended) — or paste in the dashboard (bucket → Settings → CORS)
wrangler r2 bucket cors put images --rules ./infra/r2/production/cors.json
```

---

## Lifecycle / retention

[`lifecycle.json`](./lifecycle.json):

- **Abort incomplete multipart uploads after 7 days** — reclaims storage from
  interrupted large-`original`-variant uploads.
- **Retain catalog images indefinitely** — they're content, not transient
  data; storage is bounded by catalog size because keys are deterministic.

Apply:

```bash
wrangler r2 bucket lifecycle put images --rules ./infra/r2/production/lifecycle.json
```

R2 has **no egress fees** (the whole reason we chose it, PROJECT.md § 3), so
there's no cost reason to expire `original` variants; keep them for re-
transcoding to new sizes later.

---

## Access keys

Least-privilege provisioning (read-only public/delivery key vs read-write
pipeline key) is documented in [`access-keys.md`](./access-keys.md). The
GitHub-secret mapping for the read-write pipeline key is in
`infra/DEPLOYMENT_SECRETS.md`.
