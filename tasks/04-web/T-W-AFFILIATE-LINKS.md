# T-W-AFFILIATE-LINKS — TCGplayer affiliate "Buy" CTAs on card detail (web + mobile)

**Stage:** 04-web
**Agent role:** frontend-web (spans frontend-web + frontend-mobile — see § Goal)
**Effort:** S
**Status:** in_review

## Hard dependencies

- T-W-BROWSE (merged) — provides the web `<CardView>` we wire into
  and the mobile `<CardScreen>` (T-M-BROWSE landed in the same iter).

## Soft dependencies

- T-SP-PRICING-DISPLAY (merged) — the "Buy" CTA lives next to the
  prices placeholder on card detail. Once `T-W-PRICING` wires the
  pricing-display package up (see #FU-17), the BuyCta sits beneath
  the price graph, but the wiring is unchanged.

## Required reading

- PROJECT.md § 13 (Pricing & Affiliate Strategy) — confirms TCGplayer
  is the _purchase_ path while eBay / Cardmarket are the _valuation_
  signal. The CTA is visually distinct from the price display and the
  price display always discloses its source.
- rules/04-web.md (frontend conventions)
- rules/05-mobile.md (frontend conventions for the mirror surface)

## Goal

Ship the `<BuyCta>` component on both card-detail surfaces (web
`/cards/[id]` and mobile `CardScreen`). The CTA links out to a
TCGplayer search URL with our affiliate program id appended as a UTM
param. When the affiliate id is missing (no `NEXT_PUBLIC_TCGPLAYER_AFFILIATE_ID`
or `EXPO_PUBLIC_TCGPLAYER_AFFILIATE_ID` env var), the button renders
disabled with a "Coming soon" hint so the surface degrades cleanly
in dev / preview builds.

This is the first revenue surface in the product. Click attribution
is owned by TCGplayer's Impact partner dashboard — we do **not**
record click events server-side in v1.

## Deliverables

- `apps/web/lib/affiliate/tcgplayer.ts` — pure URL builder
  (`buildTcgplayerUrl(card, { affiliateId })`). Returns a fully
  URL-encoded `https://tcgplayer.com/...` string or `null` when the
  affiliate id is missing.
- `apps/web/lib/affiliate/index.ts` — barrel + `buildWebTcgplayerUrl`
  and `buildMobileTcgplayerUrl` convenience wrappers that read the
  env var name from `Record<string, string | undefined>` (default:
  `process.env`).
- `apps/web/components/buy-cta/BuyCta.tsx` — web `<BuyCta>` client
  component. Wraps `@binderly/ui`'s `<Button>` in an `<a target="_blank">`
  for the enabled path; degrades to a disabled button inside a
  `title="Coming soon"` tooltip span when no affiliate id is available.
- `apps/web/components/buy-cta/index.ts` — barrel.
- `apps/mobile/src/components/buy-cta/tcgplayer.ts` — pure URL builder
  (line-for-line copy of the web version; documented duplication —
  cross-app workspace dep is not in scope at this size).
- `apps/mobile/src/components/buy-cta/BuyCta.tsx` — mobile `<BuyCta>`.
  Uses `expo-web-browser`'s `openBrowserAsync` (in-app browser for
  better attribution) with a `Linking.openURL` fallback for devices
  with no custom-tabs / SFSafariViewController.
- `apps/mobile/src/components/buy-cta/index.ts` — barrel.
- Wired into:
  - `apps/web/components/browse/CardView.tsx` (new "Buy" card section
    between the prices placeholder and the "Add to collection"
    placeholder).
  - `apps/mobile/src/screens/card/CardScreen.tsx` (same position).
- Env templates: `NEXT_PUBLIC_TCGPLAYER_AFFILIATE_ID` added (commented-
  out) to `apps/web/.env.example`; `EXPO_PUBLIC_TCGPLAYER_AFFILIATE_ID`
  added to `apps/mobile/.env.example`.
- Open question Q-011 + follow-up #FU-24 logged: exact TCGplayer
  affiliate URL format unconfirmed. The brief explicitly authorised
  shipping a documented placeholder.

## Acceptance criteria

- [x] `buildTcgplayerUrl` returns a URL with the TCGplayer affiliate
      base, `productLineName=pokemon`, the four UTM params, and the
      provided affiliate id.
- [x] URL is properly encoded for cards with apostrophes (`Farfetch'd`)
      and accented characters (`Pokémon Center Lady`) — covered by
      `URLSearchParams.toString()` and pinned in tests.
- [x] Missing affiliate id (undefined / null / empty / whitespace)
      returns `null` and the UI renders the degraded "Coming soon"
      state.
- [x] Missing card name returns `null` (same degraded state). Belt-
      and-suspenders so a malformed catalog row never sends users to
      a useless TCGplayer search.
- [x] Web `<BuyCta>` renders an `<a target="_blank"
    rel="noopener noreferrer sponsored">` wrapping the button when
      enabled.
- [x] Web `<BuyCta>` renders a disabled button inside a
      `title="Coming soon"` span when no affiliate id is available.
      Accessible label includes "coming soon".
- [x] Mobile `<BuyCta>` calls `expo-web-browser.openBrowserAsync` on
      press (mocked in the test suite).
- [x] Mobile `<BuyCta>` falls back to `Linking.openURL` when
      `openBrowserAsync` throws.
- [x] Mobile `<BuyCta>` renders the disabled state with a "Coming
      soon" hint when no affiliate id is available.
- [x] Integration test: `<CardView>` (web) renders the `<BuyCta>` in
      a `card-buy` section (degraded, since the test env has no
      affiliate id).
- [x] Integration test: `<CardScreen>` (mobile) renders the
      `<BuyCta>` in a `card-buy` section (same — degraded under jsdom).
- [x] Tests live under each owns_path and pass under `pnpm --filter
    @binderly/web test` + `pnpm --filter @binderly/mobile test`.
- [x] `pnpm --filter @binderly/web build` succeeds with NO env vars
      set (the degraded "Coming soon" path is the build-time default).
- [x] No changes outside `owns_paths` except the two pre-authorised
      wiring edits (`apps/web/components/browse/CardView.tsx` and
      `apps/mobile/src/screens/card/CardScreen.tsx`) plus the
      explicitly-allowed env templates, lockfile, task file, and
      `open-questions.md`.

## Out of scope

- Click-tracking server-side (TCGplayer Impact UTM is enough for v1).
- No backend `affiliate_click` table or event.
- Multi-marketplace variants (CardMarket, eBay) — TCGplayer only.
- Pricing-display wire-up (per #FU-17, the pricing-display package
  is merged but its CardView integration is a separate pass).
- The Impact partner application itself — that's a Pablo / business
  task, not a code task.

## Branch & PR

- Branch: `agent/T-W-AFFILIATE-LINKS`
- PR title: `feat(web): T-W-AFFILIATE-LINKS — TCGplayer Buy CTAs on card detail (web + mobile)`
- Commit format: Conventional Commits.

## Escalation triggers

Stop and surface to orchestrator if:

- The affiliate URL format turns out to be incompatible with what
  Impact's dashboard expects (see Q-011 / #FU-24).
- The wiring edits to `CardView.tsx` / `CardScreen.tsx` conflict with
  in-flight work in T-W-PRICING / T-M-PRICING.

## Notes from execution

- **Cross-app URL builder duplication.** The pure-logic URL builder
  is duplicated into both `apps/web/lib/affiliate/tcgplayer.ts` and
  `apps/mobile/src/components/buy-cta/tcgplayer.ts`. The web app is
  not a workspace dependency of the mobile app (`@binderly/web` is
  the Next.js shell, not a published library), so a clean import is
  not available without lifting the function into `packages/`. The
  duplicate is ~30 lines, kept in lockstep via a docstring pointer
  in both files. If a third caller appears (e.g. an edge function),
  we promote to a new `packages/affiliate-urls` package.
- **TCGplayer URL format placeholder (#FU-24 / Q-011).** The brief
  explicitly told us to ship a documented placeholder if we couldn't
  verify the wire format against Impact's docs. We have not signed
  up for the program yet, so the URL template (`search/pokemon/product`
  with `utm_*` triple + `utm_id=<affiliate>`) is a best-effort
  approximation. The degraded "Coming soon" state ships as the
  production default until a real affiliate id lands in the
  environment, so end users see the same disabled UX they did before
  this PR until #FU-24 is closed.
- **`expo-web-browser` vs. `Linking.openURL`.** The mobile component
  prefers `WebBrowser.openBrowserAsync` because (a) the in-app
  browser preserves the user's TCGplayer session across visits
  (better affiliate attribution) and (b) it keeps users a single
  back-swipe away from Binderly. We fall back to `Linking.openURL`
  silently when `openBrowserAsync` throws (rare — happens when no
  custom-tabs provider is installed on Android).
- **Test posture.** Both `<BuyCta>` test suites expose explicit prop
  test seams (`affiliateId`, `buildUrl`, `onOpenUrl`) so the suite
  never has to monkey-patch the affiliate-id env var globally. The
  global env is `delete`d in `beforeEach`, restored in `afterEach`.
  The two integration tests (CardView / CardScreen) rely on the env
  being absent under jsdom and assert the degraded UI renders — that
  doubles as the missing-env regression test the orchestrator can
  catch in CI.
- **Pre-authorised outside-owns_paths edits.** Per the dispatch brief:
  - `apps/web/components/browse/CardView.tsx` — added a new
    `card-buy` section + new `<BuyCta>` import. Single-block insert
    between the prices placeholder and the add-to-collection
    placeholder.
  - `apps/mobile/src/screens/card/CardScreen.tsx` — same shape.
  - `apps/web/components/browse/CardView.test.tsx` and
    `apps/mobile/src/screens/card/CardScreen.test.tsx` — added one
    integration test each. Necessary to satisfy the AC; treating
    this as implicitly authorised by the AC list.
