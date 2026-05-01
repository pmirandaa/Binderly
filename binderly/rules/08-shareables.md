# Stage 08 — Shareables rules

Public, no-auth pages over a configurable view of a user's collection.
SSR Next.js with proper OG. Free: 1 shareable. Pro: unlimited + themed.

## Required reading

- `PROJECT.md` § 14 (Shareables)
- `context/data-model.md` (`shareable`, `profile.handle`)
- `context/legal-and-brand.md` (image hosting)

## Hard rules

- **Public pages SSR with full meta tags.** OpenGraph (title,
  description, image), Twitter card (summary_large_image), canonical
  link. Test with debug.dev and twitter.com/cards.
- **No PII leakage.** A shareable shows only what the owner explicitly
  configured (handle, display_name, avatar, the data they ticked on).
  Email, real name, IP, sub claim — never.
- **Anonymous read works.** No login walls on `/c/{handle}/{slug}`.
  Cache-friendly headers; revalidate on owner change.
- **Themes are paid-only.** Free shareables use the default theme. Pro
  users pick from a small fixed set. Enforced server-side at render time.
- **Owner can disable a shareable instantly** (kill switch). Disabled
  shareable → 404 (not 410, to keep search engines happy if they
  enable a different slug later).

## Conventions specific to this stage

- OG endpoint at `/api/og` builds an image from a URL-encoded payload
  signed with a server secret to prevent abuse.
- Shareable cache: `s-maxage=300, stale-while-revalidate=86400`.
- Theme registry in `apps/web/app/c/themes/`. Each theme is a layout +
  token override.

## Common pitfalls

- Vercel OG / Satori has a strict subset of CSS. Keep templates simple.
- Long card grids make the page heavy — paginate or virtualize for
  collections with 1000+ items.
- Owner edits to the shareable should invalidate the CDN cache.

## Done when

- A user can configure a shareable, share the URL, and see proper
  social previews on Slack, Discord, X, Bluesky, and iMessage.
- Pro user theming works and persists.
- Disabling a shareable removes public access immediately.
