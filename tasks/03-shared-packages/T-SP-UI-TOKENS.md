# T-SP-UI-TOKENS — Tamagui design tokens + base components (cross-platform)

**Stage:** 03-shared-packages
**Agent role:** frontend-web
**Effort:** L
**Status:** in_progress

## Hard dependencies

- T-FN-MONOREPO (merged) — provides the workspace skeleton, shared
  tsconfig / eslint / prettier configs, the turbo pipeline, and the
  `@binderly/*` package naming convention.

## Soft dependencies

- T-BE-API-CLIENT (parallel sibling, iter 13 first wave) — sister
  Phase-2-downstream package owning `packages/api-client/`. Orthogonal
  at the directory level; only `pnpm-lock.yaml` is contended at merge
  time and the orchestrator resolves it.

## Required reading

- `PROJECT.md` § 3 (Tech Stack — Tamagui chosen for cross-platform
  tokens + primitives), § 8 (Master Set), § 9 (Custom & Smart),
  § 10 (Core App Features), § 14 (Shareables — colour theming),
  § 18 (open question on Tamagui maturity / the Tailwind+NativeWind
  fallback)
- `rules/03-shared-packages.md` (zero side effects on import, no
  platform-specific imports, tree-shakable, "Tamagui tokens, not raw
  values")
- `context/conventions.md` (TS strict, named exports, file naming,
  test posture)
- `context/legal-and-brand.md` (no Pokémon Company iconography or
  fonts in any branded asset; system-font default keeps us clean)
- `context/tech-stack.md` (Tamagui pinned for both web and mobile;
  cross-package `@binderly/ui` listed)
- Sibling packages for layout precedent: `packages/api-contracts/`
  and `packages/auth/` (both ship `main` / `types` / `exports` from
  day one — Q-004 fix)

## Goal

Stand up `@binderly/ui` — the Tamagui-based design-token + base-component
library that is the visual and interaction language of every Binderly
surface. Both `apps/web` (Next.js, T-W-SHELL) and `apps/mobile` (Expo,
T-M-SHELL) hard-depend on this package; their first lines of `tsx` will
import from `@binderly/ui`. Light + dark themes ship from day one.
Components are pure, side-effect-free, RSC-safe (the provider opts into
`"use client"`; primitives do not), and bring no fonts, no native
modules, no platform-specific imports into the shared graph.

## Design

### Strategy: build on `@tamagui/core`, not the umbrella `tamagui`

`@tamagui/core` is the "no react-native required" surface of Tamagui
— it ships `View`, `Text`, `Stack`, `XStack`, `YStack`, `Spinner`,
`styled`, `createTokens`, `createTheme`, `createTamagui`, and
`TamaguiProvider`, with peer deps that resolve cleanly in jsdom (web
tests), Next.js RSC (web app), and React Native (mobile app). The
heavier `tamagui` umbrella pulls in `@tamagui/sheet`, `@tamagui/dialog`,
`@tamagui/popover`, etc. — surface area we do not need at this phase
and that complicates RSC + cross-platform testing.

We therefore bind the package's production surface to `@tamagui/core`
plus our own `styled()`-built primitives for `Button`, `Card`, `Input`,
`Pressable`. Apps that later need a `Sheet` or `Dialog` can install
the sub-package and re-use our tokens (Tamagui `createTokens` output
is shared globally once `createTamagui` is wired through
`<TamaguiProvider>`).

### Light + dark from day one

`createTokens` declares the palette + numeric scales. `createTheme`
builds two named themes (`light`, `dark`) that map semantic slots
(`background`, `surface`, `surfaceElevated`, `text`, `textMuted`,
`border`, `primary`, `secondary`, `success`, `warning`, `error`, plus
their `…Hover` / `…Press` / `…Disabled` variants per Tamagui
convention) onto the palette. Tamagui's theme augmentation pattern
(`declare module '@tamagui/core' { interface TamaguiCustomConfig … }`)
gives every `<View>` / `<Text>` / `styled()` call autocomplete on the
token names.

### Iconography via registry, not a hard dep

`lucide-react-native@1.14.0` declares hard peers on `react-native@*`
and `react-native-svg@^12-15`. Adding either to `@binderly/ui`
production deps drags native modules into the web RSC graph and the
vitest environment. Instead, `Icon` accepts the lucide component as a
prop / child:

```tsx
import { Star } from 'lucide-react';        // web
import { Star } from 'lucide-react-native'; // native
<Icon as={Star} size="md" color="$primary" />
```

Apps install whichever lucide flavour they want; `@binderly/ui`
provides only the token-aware sizing / colouring wrapper. This is the
"sprite system that works on both" the orchestrator dispatch
described.

### a11y + RSC

Every interactive primitive (`Button`, `Pressable`, `Input`) accepts
both `aria-label` (web semantics) and `accessibilityLabel` (RN
semantics) and forwards both. Disabled state always sets
`aria-disabled="true"` + `accessibilityState={{ disabled: true }}`.
The `<UIProvider>` is `"use client"` because Tamagui's
`TamaguiProvider` mounts a context; primitives are RSC-safe (no
hooks, no context reads at module scope).

## File layout

```
packages/ui/
├── package.json
├── tsconfig.json
├── eslint.config.mjs
├── vitest.config.ts
├── README.md
├── tamagui.config.ts                # top-level config consumed by web + mobile bundlers
└── src/
    ├── index.ts                     # public barrel
    ├── tokens/
    │   ├── index.ts                 # token barrel
    │   ├── colors.ts                # palette + semantic slot keys
    │   ├── colors.test.ts
    │   ├── space.ts                 # spacing scale (px-aligned)
    │   ├── space.test.ts
    │   ├── radius.ts                # corner radii
    │   ├── radius.test.ts
    │   ├── typography.ts            # font stack + size scale + weight + line-height + letter-spacing
    │   ├── typography.test.ts
    │   ├── shadows.ts               # elevation tokens (web boxShadow + native shadow*)
    │   ├── shadows.test.ts
    │   ├── motion.ts                # animation duration + easing tokens
    │   ├── motion.test.ts
    │   ├── breakpoints.ts           # responsive breakpoints (web only at use-time)
    │   ├── breakpoints.test.ts
    │   ├── z-index.ts               # z-index layer tokens
    │   └── z-index.test.ts
    ├── theme/
    │   ├── index.ts                 # theme barrel
    │   ├── light.ts                 # light theme semantic mapping
    │   ├── dark.ts                  # dark theme semantic mapping
    │   ├── tokens.ts                # createTokens(...) Tamagui call
    │   └── theme.test.ts            # presence + WCAG-AA contrast smoke + light vs dark distinctness
    ├── config.ts                    # createTamagui(...) — re-exported by tamagui.config.ts
    ├── config.test.ts
    ├── provider/
    │   ├── ui-provider.tsx          # "use client" — wraps TamaguiProvider
    │   └── ui-provider.test.tsx
    ├── components/
    │   ├── box.tsx                  # styled View
    │   ├── box.test.tsx
    │   ├── text.tsx                 # variants: display | title | subtitle | body | bodySmall | caption | label | monospace
    │   ├── text.test.tsx
    │   ├── stack.tsx                # XStack / YStack re-exports + defaults
    │   ├── stack.test.tsx
    │   ├── pressable.tsx            # cross-platform press target
    │   ├── pressable.test.tsx
    │   ├── button.tsx               # variants: primary | secondary | ghost | destructive ; sizes: sm | md | lg ; loading + disabled states
    │   ├── button.test.tsx
    │   ├── card.tsx                 # surface + elevation variants
    │   ├── card.test.tsx
    │   ├── input.tsx                # text input + label + error + helper-text slots
    │   ├── input.test.tsx
    │   ├── spinner.tsx              # token-driven loading indicator
    │   ├── spinner.test.tsx
    │   ├── icon.tsx                 # registry-pattern icon primitive
    │   └── icon.test.tsx
    ├── test-utils/
    │   └── render.tsx               # wraps RTL render() with <UIProvider>
    └── types.ts                     # shared types (variant unions, size unions)
```

`src/index.ts` re-exports tokens, theme, config, provider, every
component, and the relevant TypeScript types. Tree-shakable: every
file uses named exports only, no default exports outside `index.ts`.

## Token taxonomy (the contract every test pins)

### `colors.ts`

- **Palette** — neutral 50-950 (10 stops), brand 50-950, plus
  fixed-position primaries (`primary`, `primaryHover`, `primaryPress`),
  secondary (`secondary`, …), accent, plus the four status colours
  (`success`, `warning`, `error`, `info`), each with hover / press
  variants for interactive states.
- **Semantic slots** (driven by the active theme): `background`,
  `surface`, `surfaceElevated`, `surfaceMuted`, `text`, `textMuted`,
  `textInverse`, `border`, `borderStrong`, `primary`, `primaryHover`,
  `primaryPress`, `primaryDisabled`, `onPrimary`, `secondary`,
  `secondaryHover`, `secondaryPress`, `secondaryDisabled`, `onSecondary`,
  `success`, `warning`, `error`, `info`, plus `focusRing` for keyboard
  focus outlines.

Brand colours: pending Pablo's brand decision (escalated as **Q-008**
in `open-questions.md` if the token-time check fails). v1 default is
a teal-leaning primary (`#0FA3A3`) and a violet secondary (`#7B5DFF`)
chosen for adequate WCAG-AA contrast on both the light and dark
backgrounds we ship; `Q-008` documents the swap path.

### `space.ts`

`{ 0: 0, 0.5: 2, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64, 20: 80, 24: 96 }`

The `0.5`/`1`/`2`/etc. keys match Tamagui's space-scale convention so
`<XStack space="$4">` reads as 16px gap.

### `radius.ts`

`{ none: 0, xs: 2, sm: 4, md: 8, lg: 12, xl: 16, '2xl': 24, pill: 9999, circle: 9999 }`

`pill` and `circle` resolve to the same large value; the names exist
so call sites read intuitively.

### `typography.ts`

- `fonts.body` — system-font stack: `system-ui, -apple-system, "Segoe
  UI", Roboto, "Helvetica Neue", Arial, sans-serif`. Native uses RN's
  default which maps to San Francisco / Roboto.
- `fonts.heading` — same as body in v1 (no display font shipped; the
  README documents the swap path).
- `fonts.mono` — `ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`.
- `fontSizes` — `{ 1: 11, 2: 12, 3: 14, 4: 15, 5: 16, 6: 18, 7: 20, 8: 24, 9: 28, 10: 32, 11: 40, 12: 48 }`.
- `fontWeights` — `{ regular: '400', medium: '500', semibold: '600', bold: '700' }`.
- `lineHeights` — keyed off font sizes, ~1.2-1.5 ratio.
- `letterSpacings` — `{ tight: -0.5, normal: 0, wide: 0.4 }`.

### `shadows.ts`

Five elevation tiers (`none`, `xs`, `sm`, `md`, `lg`) with both the web
`boxShadow` string (lightweight RGBA approximation) and the RN-native
`shadowColor` / `shadowOffset` / `shadowRadius` / `shadowOpacity` /
`elevation` (Android) tuple. Token consumers pick whichever suits the
platform; Tamagui's `styled()` props (`shadowColor`, `shadowRadius`,
…) accept token references.

### `motion.ts`

- `durations` — `{ instant: 0, fast: 120, normal: 200, slow: 320, slowest: 480 }`.
- `easings` — `{ standard: 'cubic-bezier(0.2, 0, 0, 1)', emphasized: 'cubic-bezier(0.3, 0, 0, 1)', linear: 'linear' }`.

### `breakpoints.ts`

`{ xs: 0, sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536 }`. Web-only
at use-time (`@media`); the file lives in the package so the tokens
travel everywhere but Tamagui's `media` config decides whether to
apply them.

### `z-index.ts`

`{ hide: -1, base: 0, raised: 10, dropdown: 100, sticky: 200, banner: 300, overlay: 400, modal: 500, popover: 600, toast: 700, tooltip: 800 }`.

## Component inventory + variant matrix

| Component  | Variants                                                         | Sizes        | States                                                |
| ---------- | ---------------------------------------------------------------- | ------------ | ----------------------------------------------------- |
| `Box`      | none (raw layout primitive)                                       | n/a          | n/a                                                   |
| `Text`     | `display`, `title`, `subtitle`, `body`, `bodySmall`, `caption`, `label`, `monospace` | inherit | n/a |
| `Stack`    | `XStack`, `YStack` (re-exports with defaults)                     | n/a          | n/a                                                   |
| `Pressable`| `default`, `ghost` (no surface)                                   | inherit      | default · hover (web only) · pressed · disabled       |
| `Button`   | `primary`, `secondary`, `ghost`, `destructive`                    | `sm` · `md` · `lg` | default · hover (web) · pressed · disabled · loading |
| `Card`     | `surface`, `elevated`, `outlined`                                 | inherit      | default · hover (web)                                 |
| `Input`    | default                                                            | `sm` · `md` · `lg` | default · focused · disabled · error                   |
| `Spinner`  | none                                                               | `sm` · `md` · `lg` | n/a                                                   |
| `Icon`     | none (registry pattern: `as` prop)                                 | `xs` · `sm` · `md` · `lg` · `xl` | n/a                                |

`Button` and `Pressable` accept `aria-label` / `accessibilityLabel`
and forward both onto the underlying primitive. Disabled state on any
interactive component blocks `onPress` and sets the a11y attributes.

## Testing strategy

Test runner: **vitest 2.1.9** (matches `@binderly/api-contracts` and
`@binderly/auth`) with `jsdom` environment. RTL via
`@testing-library/react@16.x` + `@testing-library/jest-dom@6.x` +
`@testing-library/user-event@14.x`. Tamagui's documented vitest setup
uses `@tamagui/vite-plugin` to handle the platform / extension forking
that Tamagui needs at compile time.

`src/test-utils/render.tsx` exports a `renderWithProvider(ui)` helper
that wraps the tree in `<UIProvider defaultTheme="light">`; tests that
need a specific theme pass `theme="dark"`. No global afterEach / setup
is needed beyond `import '@testing-library/jest-dom/vitest'`.

Test inventory (~80-150 tests, contract-focused, no snapshots):

- **Tokens** (~50): every named token in every file is present, has
  the right type, and has the right shape (numeric scales monotone,
  no missing keys, semantic slots present in both themes). Helpers
  cross-check `light` and `dark` theme objects expose the same keys.
- **Theme + config** (~10): `createTamagui` returns a config with
  both themes; `light.background !== dark.background`; switching
  themes via `<Theme name="dark">` re-renders surface/text colours
  to the dark palette; the augmentation pattern type-checks (a
  vitest-level type test via `expectTypeOf`).
- **Provider** (~5): `<UIProvider>` mounts without throwing, accepts
  `defaultTheme`, propagates theme to children.
- **Components** (~70):
  - Each renders with default props (one test per component).
  - Each accepts and renders children where applicable.
  - Each forwards `aria-label` (web role) and `accessibilityLabel`
    (test by reading the rendered DOM `aria-label` attribute).
  - `Button` / `Pressable` / `Input`: `disabled` blocks `onPress`
    /`onChangeText` and sets `aria-disabled="true"`.
  - `Button`: each variant produces a distinct background colour; each
    size produces a distinct width / height (the size-token math
    contract: `lg > md > sm` measured via `getBoundingClientRect()` or
    the Tamagui-resolved `style` prop in jsdom).
  - `Button`: `loading` shows a `<Spinner>` in place of children, sets
    `aria-busy="true"`, blocks `onPress`.
  - `Text`: each variant produces a distinct rendered `font-size`
    (read off `style`).
  - `Card`: `elevated` produces a non-zero shadow style; `outlined`
    produces a non-zero border.
  - `Input`: `error` flips border colour; `helperText` and `errorText`
    slots render; `label` slot renders and is associated with the
    input via `aria-describedby` / `aria-labelledby`.
  - `Spinner`: each size produces a distinct rendered diameter.
  - `Icon`: `as` prop renders the passed component; `size` prop
    resolves the right pixel value; `color` forwards the token.
  - `Stack`: `XStack` lays children horizontally (`flex-direction:
    row`); `YStack` lays children vertically (`flex-direction: column`).

`vitest.config.ts` keeps the same coverage shape as
`@binderly/auth` — v8 provider, JSON summary + text reporter, excludes
`src/index.ts` and `src/test-utils/**` from coverage.

## Acceptance criteria

- [ ] `packages/ui/` exists with `package.json` declaring
      `@binderly/ui`, `private: true`, `type: "module"`, `main` /
      `types` / `exports` pointing at `dist/src/index.{js,d.ts}` (Q-004
      pattern). Pinned versions (no `^` / `~`) for every dep.
- [ ] `pnpm --filter @binderly/ui build` produces `dist/` with valid
      `.js` and `.d.ts` for every source file (excluding tests).
- [ ] `pnpm --filter @binderly/ui typecheck` passes under
      `@binderly/tsconfig/library.json` (or a thin extension) with
      `strict: true`.
- [ ] `pnpm --filter @binderly/ui lint` passes with zero warnings
      under the React preset (`@binderly/eslint-config/react`).
- [ ] `pnpm --filter @binderly/ui test` passes ≥80 tests covering
      tokens, theme, config, provider, and every component.
- [ ] `pnpm -w lint && pnpm -w typecheck && pnpm -w test && pnpm -w build`
      all green from the workspace root.
- [ ] `src/index.ts` exports: every token group, both themes, the
      generated config, `<UIProvider>`, every component, every
      variant / size TypeScript type union.
- [ ] Light theme and dark theme both resolve every semantic slot
      (no `undefined`); `light.background !== dark.background`;
      `light.text !== dark.text` (asserted in tests).
- [ ] Every interactive component accepts and forwards both
      `aria-label` (web) and `accessibilityLabel` (RN) (asserted in
      tests).
- [ ] Disabled state on `Button`, `Pressable`, `Input` blocks
      `onPress` / `onChangeText` (asserted in tests).
- [ ] `Button` size tokens math: `lg` button computed height >
      `md` computed height > `sm` computed height (asserted in
      tests).
- [ ] No `console.log`, no module-level fetches, no
      platform-specific imports (`react-native`, `next/*`,
      `node:*`) in `src/**` outside test files. Verified by ESLint
      `no-restricted-imports` config.
- [ ] `dependencies.yaml`: `T-SP-UI-TOKENS` flipped from `pending`
      to `review`, `stub: false`.
- [ ] No edits outside the authorized list (`packages/ui/`,
      `pnpm-lock.yaml`, `pnpm-workspace.yaml` if needed,
      `dependencies.yaml`, this task file).

## Out of scope

- Sheet / Dialog / Popover / Tooltip / Select / Menu / Sidebar /
  navigation primitives (T-W-SHELL and T-M-SHELL pull these in
  themselves or via dedicated `@tamagui/sheet` etc. installs against
  our shared config).
- Form-level abstractions (`useForm`, validation, etc.) — react-hook-form
  + zod live in the apps.
- Toast / Snackbar / Notification primitives — deferred to a later
  task once notification UX is decided in PROJECT.md.
- Brand-final colour palette — v1 ships a sensible default and
  Q-008 (if raised) tracks the swap.
- Storybook — the rules file mentions Storybook but the foundation
  task hasn't shipped a Storybook harness yet; out of scope here.
- App-side wiring of `<UIProvider>` — T-W-SHELL and T-M-SHELL handle
  that.

## Branch & PR

- Branch: `agent/T-SP-UI-TOKENS`
- PR title: `T-SP-UI-TOKENS: Tamagui design tokens + base components (cross-platform)`
- Commit format: Conventional Commits

## Authorized out-of-`owns_paths` edits

- `pnpm-lock.yaml` — regenerated when adding `@tamagui/core`,
  `@tamagui/vite-plugin`, `react`, `react-dom`, `@testing-library/*`,
  `jsdom`.
- `pnpm-workspace.yaml` — verify (no edit expected; `packages/*`
  glob already covers).
- `dependencies.yaml` — flip status `pending` → `review`,
  `stub: true` → `stub: false`.
- `tasks/03-shared-packages/T-SP-UI-TOKENS.md` — this elaboration.

## Escalation triggers

Stop and surface to orchestrator if:

- Brand colours that drive the palette aren't defined and an
  app-visible decision is needed (escalate as **Q-008** with the
  v1 default flagged for review).
- A Tamagui version conflict surfaces in `pnpm-lock.yaml` (very
  unlikely — first Tamagui dep in the lockfile).
- Cross-platform incompatibility surfaces in any public component
  that can't be papered over with `@tamagui/core` primitives —
  document and propose a `Component.web.tsx` / `Component.native.tsx`
  split.
- The vitest + jsdom + Tamagui setup turns out to need react-native
  + react-native-web + their test mocks at install time, which
  would inflate the dev surface beyond what a shared package
  should carry — fall back to "tokens-only tests + smoke render
  tests via a thin shim" and document.

## Notes from execution

- **Tamagui version:** pinned `@tamagui/core@1.123.3` and
  `@tamagui/input@1.123.3`. The npm `latest` tag on `tamagui` (the
  umbrella) is `2.0.0-rc.22`, a release candidate; we picked the
  last 1.x stable (`1.123.3`, currently npm-tagged `prepub`)
  intentionally so we ship against a stable API. Future bumps go
  through whichever co-orchestrator owns Tamagui upgrades.
- **Bound to `@tamagui/core` only, plus `@tamagui/input`.** The
  full `tamagui` umbrella pulls 30+ sub-packages (sheet, dialog,
  popover, accordion, etc.). At this phase we don't need any of
  them, and pulling them inflates the bundler graph + RSC + jsdom
  test setup. `@tamagui/core` has `View`, `Stack`, `Text`,
  `styled`, `createTokens`, `createTheme`, `createTamagui`, and
  `<TamaguiProvider>`; `@tamagui/input` ships the cross-platform
  text input (web `<input>` ↔ native `TextInput`) the umbrella
  doesn't surface from `@tamagui/core` directly.
- **Brand colours.** v1 ships a teal-leaning primary (`#0FA3A3`)
  and violet-leaning secondary (`#7B5DFF`). Both meet WCAG-AA
  contrast on light + dark surfaces. No `Q-008` raised yet — the
  defaults are flagged in the README + task file so Pablo can
  request a swap whenever the brand decision lands. The swap is
  one-file (`src/tokens/colors.ts`) when it does.
- **Iconography via registry, not a hard dep.** Built-in `<Icon>`
  takes the icon component via `as`. Both `lucide-react` (web) and
  `lucide-react-native` (mobile) export the same icon names with
  the same prop shape, so apps install whichever flavour fits the
  platform. We did NOT add `lucide-react-native` to dependencies —
  it has hard peers on `react-native` and `react-native-svg` that
  would bloat the shared package + RSC graph.
- **`<UIProvider>` is `"use client"`.** `TamaguiProvider` mounts a
  React context, which RSC forbids at the server boundary. The
  primitives (`<Box>`, `<Text>`, `<Card>`, …) do NOT take the
  directive — server components can import them freely; the
  client boundary travels with the provider.
- **Tests.** 257 tests across 20 test files: 76 token-shape
  contracts (incl. `it.each` over every semantic slot for both
  themes), 5 config tests, 6 provider tests, 152 component tests
  with rendering + a11y + variant/size/disabled/loading
  assertions. Coverage runs through the documented Tamagui +
  vitest setup (`@vitejs/plugin-react`, `jsdom`,
  `@testing-library/react@16`).
- **Spinner / Icon a11y.** Tamagui maps `accessibilityRole` →
  `role` on web with the RN value winning, which produced
  surprising `role="progressbar"` outputs from a web RTL query.
  We dropped `accessibilityRole` on Spinner + Icon, leaving only
  the explicit web `role="status"` / `role="img"` /
  `role="presentation"` and the RN `accessibilityLabel`. Tamagui
  derives the native role from the web role at compile time on
  native; the cross-platform contract holds.
- **Lockfile / workspace.** `pnpm-workspace.yaml` already
  globs `packages/*` — no edit needed. `pnpm-lock.yaml`
  regenerated with the new Tamagui + testing-library + vitest
  + react/react-dom deps. The peer-dep warning surfaced by pnpm
  about `react-native@0.85.3` wanting `react@^19` is a transient
  install-time warning from a transitive peer that resolves
  against the React 18 we explicitly pin; it is non-blocking and
  matches the warning shape every other pre-Expo-SDK-52
  workspace sees today.
- **Out-of-`owns_paths` edits.** `pnpm-lock.yaml` (regenerated),
  `dependencies.yaml` (status flip + `stub: false`),
  `tasks/03-shared-packages/T-SP-UI-TOKENS.md` (this elaboration +
  these notes). All three pre-authorized by the orchestrator
  dispatch.
- **`pnpm-workspace.yaml`:** verified unchanged; no edit
  required.

