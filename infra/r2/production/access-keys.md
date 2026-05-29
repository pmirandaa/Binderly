# R2 access keys — least-privilege provisioning

R2 exposes an S3-compatible API authenticated with **R2 API tokens**
(account-scoped access key id + secret). We provision **two** distinct
tokens so the public delivery path never holds write scope.

> No live keys are committed anywhere. These are provisioning instructions;
> the secrets live in platform secret managers (GitHub Actions secrets for
> CI, Fly secrets for the Python service) per `rules/11-deployment.md`.

---

## Key 1 — read-write **pipeline** key (write scope)

Used by the data-pipeline / Python service to **write** transcoded WebP
variants into the `images` bucket (and to write `models` / `ann` artefacts).

- **Cloudflare:** R2 → Manage R2 API Tokens → Create API Token.
- **Permission:** **Object Read & Write**.
- **Scope:** limit to the `images`, `models`, `ann` buckets (NOT account-wide
  if the bucket-scoping option is available).
- **Maps to GitHub secrets** (consumed by the pipeline / a future ingestion
  workflow) — see `infra/DEPLOYMENT_SECRETS.md`:
  - `R2_ACCOUNT_ID`
  - `R2_ACCESS_KEY_ID`
  - `R2_SECRET_ACCESS_KEY`
  - `R2_BUCKET` (`images`)
  - `R2_ENDPOINT` (`https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`)
- Also set as **Fly secrets** on the Python service (`fly secrets set ...`)
  if/when it writes artefacts directly.

The pipeline's `S3ImageStorage` takes `{ bucket, publicUrlPrefix, client }`
where `client` is an `@aws-sdk/client-s3` `S3Client` configured with
`endpoint = R2_ENDPOINT`, `forcePathStyle: true`, and these credentials.

## Key 2 — read-only **delivery** key (read scope, mostly unused)

Public catalog reads do **not** need a key at all — the `images` bucket is
public-read via the `images.binderly.app` custom domain, so browsers fetch
images anonymously over the CDN. A read-only key is only needed for a
server-side consumer that must read a **private** object or list a bucket.

- **Permission:** **Object Read only**.
- **Scope:** the specific bucket(s) that consumer reads.
- Keep it out of the browser bundle (it's an S3 credential, not a public
  CDN URL). The web app uses the public URL prefix, never a key.

---

## Rotation

1. Create a new token (same permission/scope) in the Cloudflare dashboard.
2. Update the corresponding GitHub / Fly secret(s) with the new key pair.
3. Re-run a deploy / pipeline job to confirm the new key works.
4. Revoke the old token in the dashboard.

Because the public delivery path uses the custom domain (no key), rotating
the pipeline key never interrupts image delivery to users.

## Posture summary

| Path | Auth | Scope |
| --- | --- | --- |
| Browser / web reading catalog images | none (public CDN URL) | n/a |
| Pipeline writing catalog images | Key 1 (read-write) | `images`/`models`/`ann` |
| Server reading a private object | Key 2 (read-only) | specific bucket |
| User-uploaded photos | Supabase Storage + RLS | never on R2 public |
