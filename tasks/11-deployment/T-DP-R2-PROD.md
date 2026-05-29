# T-DP-R2-PROD — R2 production buckets + access keys

**Stage:** 11-deployment
**Agent role:** devops
**Effort:** S

## Hard dependencies
- T-DL-IMAGE-PIPELINE (merged — the pipeline that writes catalog images to R2)

## Soft dependencies
- T-DP-VERCEL (the web app + OG route read catalog images cross-origin from R2)

## Required reading
- PROJECT.md § 2 (IP posture — re-host images), § 4 (Infra), § 14 (Shareables/OG)
- rules/11-deployment.md (esp. "R2 public bucket misconfiguration leaking data")
- infra/r2/README.md (the bucket layout + path scheme this mirrors for prod)
- data-pipeline image storage (`S3ImageStorage` — bucket + publicUrlPrefix contract)

## Goal
Document and provide policy files for the **production** Cloudflare R2 setup:
the bucket layout (mirroring what the image pipeline writes), a CORS policy
JSON (so the web app + OG image route can read catalog images), a
lifecycle/retention note, and a least-privilege access-key provisioning doc
(separate read-only public key vs read-write pipeline key). **Docs + policy
files only — no live keys.**

## Deliverables
- `infra/r2/production/README.md` — prod bucket layout (`images`, `models`,
  `ann` public-read; `user-uploads` is Supabase Storage, not R2), public bucket
  vs custom domain (`images.binderly.app`), and how it maps to the local MinIO buckets.
- `infra/r2/production/cors.json` — CORS policy for the `images` bucket
  (GET/HEAD from the web origins + OG route), pasteable into the R2 dashboard / `wrangler`.
- `infra/r2/production/lifecycle.json` — lifecycle/retention rules (abort
  incomplete multipart uploads; keep catalog images indefinitely; note on `original` variant).
- `infra/r2/production/access-keys.md` — least-privilege key provisioning:
  a read-only key (public delivery / web), a read-write key (pipeline writes),
  which GitHub secrets each maps to, and the rotation story.

## Acceptance criteria
- [ ] `cors.json` and `lifecycle.json` are valid JSON matching R2's S3-compatible schema.
- [ ] Bucket layout mirrors `infra/r2/README.md` (`images`/`models`/`ann` public; `user-uploads` excluded).
- [ ] Access-key doc specifies separate least-privilege read-only vs read-write keys + their GitHub secret names.
- [ ] Public-read vs private posture is explicit (catalog public; user photos never on R2 public).
- [ ] No live keys committed. No changes outside `owns_paths` (+ shared `infra/DEPLOYMENT_SECRETS.md`).

## Out of scope
- Provisioning the real R2 account / buckets / keys (Pablo, go-live).
- The custom-domain DNS setup beyond documenting `images.binderly.app`.
- User-upload storage (Supabase Storage, owned elsewhere).

## Branch & PR
- Branch: `agent/T-DP-INFRA`
- PR title: `feat(deploy): T-DP-VERCEL/FLY/SUPABASE-PROD/R2-PROD — Stage 11 deployment scaffolding (secrets pending)`

## Notes from execution
The image pipeline writes keys under `printings/{set_canonical_key}/{variant_key}/{variant}.webp`
into the `images` bucket (see `infra/r2/README.md`). Production delivery is via
the public bucket fronted by the `images.binderly.app` custom domain, which is
already allow-listed in `apps/web/next.config.mjs` `images.remotePatterns`. The
web app reads `NEXT_PUBLIC_R2_PUBLIC_BASE_URL`; the pipeline writes with an
R2 access-key pair (account-scoped S3 credentials). Two keys keep the public
delivery path from ever holding write scope.
