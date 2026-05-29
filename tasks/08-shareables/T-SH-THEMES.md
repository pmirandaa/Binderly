# T-SH-THEMES — Themed shareables (paid)

**Stage:** 08-shareables
**Agent role:** frontend-web
**Effort:** M
**Status:** elaborated

---

## Goal

Ship **pro-gated themed public shareable pages**. Per the freemium
matrix (PROJECT.md § 16), a free user gets one public shareable on the
`default` theme; a Pro user gets unlimited shareables **+ themes**. This
closes Stage 08 (shareables polish → 3/3).

The `theme_id` field already exists on the shareable config model
(stored as a string defaulting to `'default'`, validated by the
`shareableThemeSchema` enum in `@binderly/api-contracts`). This task
builds the visual theme system that consumes it: a typed theme
registry + SSR-safe renderer for the public page at
`/c/{handle}/{slug}`, a pro-gated theme picker in owner settings, and
free-tier enforcement on the public render.

## Deliverables

- **Theme registry** (`apps/web/app/c/themes/registry.ts`): a typed
  `Theme` (palette + font pairing + header treatment + card frame) and
  five concrete themes pinned to the `SHAREABLE_THEMES` id space
  (`default`, `dark`, `paper`, `neon`, `gold`). `resolveTheme` falls
  back to `default` for any stale/unknown/null id;
  `resolvePublicTheme(id, ownerIsPro)` layers the free-tier downgrade.
- **SSR-safe renderer** (`ShareableThemeProvider.tsx`): a pure render
  that paints the palette/font/header treatment and exposes
  `--share-*` CSS variables + a `useShareableTheme()` context.
- **Public page application**: `ShareableView` resolves the stored
  `theme_id` and wraps its content in the provider.
- **Settings picker** (`ThemePicker.tsx`): a gallery with live
  thumbnails, replacing the placeholder `<select>` in
  `apps/web/app/settings/shareables/`. Pro-gated via the merged
  `useGate('shareable_themes')` hook (T-PB-GATING) — free users can
  preview but a Pro theme is not persisted and surfaces
  `<UpgradePrompt>`.
- **OG palette export** (`og-palette.ts`): `ogPaletteForTheme(id)`
  exposes a flat, Satori-friendly palette so the OG worker can respect
  themes in a follow-up without `lib/og/` churn.
- **Tests**: 30+ web vitest tests (registry/resolvers, provider,
  thumbnail, picker gating, public-page theming, settings gating).

## Gating path

Uses the **merged T-PB-GATING `useGate('shareable_themes')` hook** from
`@/lib/gating` (iter 34) — not the `@binderly/entitlements` fallback.
`ThemePicker` is the gate site; `<UpgradePrompt>` is reused for the
upsell.

## Acceptance criteria

- [x] 4–5+ typed themes + `resolveTheme` fallback; SSR-safe renderer.
- [x] Public page renders the selected theme (pro) / forces default
      (free) via `resolvePublicTheme`.
- [x] Settings theme picker populated + pro-gated.
- [x] 30+ web vitest tests pass.
- [x] lint + typecheck + build green locally.
- [x] `status.md` Stage 08 → 3/3 CLOSED + `dependencies.yaml` merged.

## Out of scope / follow-ups

- **Server-side free-tier enforcement** depends on the owner's tier,
  which the public share payload does not expose (see **Q-022**).
  Interim: `resolvePublicTheme(id, null)` renders the stored theme for
  everyone; the downgrade branch is already wired for `ownerIsPro ===
  false`. Tracked by **T-BE-SHAREABLE-OWNER-TIER** (#FU-57).
- **OG image theming** — palette is exported but not yet wired into
  the OG hero. Tracked by **T-SH-OG-THEME-WIRE** (#FU-58).

## Branch & PR

- Branch: `agent/T-SH-THEMES`
- PR title: `feat(shareables): T-SH-THEMES — pro-gated themed public shareable pages`

## Notes from execution

- Themes pinned to the existing `SHAREABLE_THEMES` enum (5 ids) rather
  than inventing new ids, so server-side gating and the client renderer
  agree without an api-contracts change.
- Tamagui `Text`/`YStack` `color`/`backgroundColor` props are
  token-typed; raw theme hex is applied via the `style` escape hatch.
- `@binderly/feature-flags` + `@binderly/entitlements` are already
  `apps/web` deps (via the merged gating lib), so no `package.json`
  change was needed.
