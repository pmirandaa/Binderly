# `@binderly/ui`

Cross-platform Tamagui design tokens + base components for Binderly.
Both `apps/web` (Next.js, RSC) and `apps/mobile` (Expo / React Native)
depend on this package; their first lines of `tsx` will import from
`@binderly/ui`.

## What this package is

- **The visual + interaction language of every Binderly surface.**
  Tokens (`tokens/colors.ts`, `tokens/space.ts`, …), themes
  (`light` + `dark`), the Tamagui config the apps' bundlers consume,
  and a small inventory of base components (`Box`, `Text`, `Stack`,
  `Pressable`, `Button`, `Card`, `Input`, `Spinner`, `Icon`).
- **Cross-platform from day one.** Built on `@tamagui/core`, which
  forks at compile time to `react-native-web` on web and
  `react-native` on native. The same source compiles to both
  targets.
- **Side-effect-free on import.** No fonts, no console output, no
  module-level fetches. RSC-safe — `<UIProvider>` opts into
  `"use client"`; primitives do not.

## What this package is NOT

- **Not an icon library.** `<Icon>` is a registry-pattern wrapper:
  apps install whichever lucide flavour fits their target
  (`lucide-react` on web, `lucide-react-native` on mobile) and pass
  the icon component via the `as` prop. We deliberately avoid
  pulling `react-native-svg` and `react-native` peer deps into the
  shared graph.
- **Not a navigation / sheet / dialog library.** Components like
  `Sheet`, `Dialog`, `Popover`, `Tooltip` will land in app-level
  installs of the matching `@tamagui/*` sub-packages on top of our
  shared config. This package keeps a deliberately narrow surface.
- **Not the form library.** `react-hook-form` + `zod` live in the
  apps; `@binderly/ui` exposes only the primitives forms render
  through (`Input`, `Button`, `Text`).

## Layout

```
packages/ui/
├── package.json
├── tsconfig.json
├── eslint.config.mjs
├── vitest.config.ts
├── README.md                     # this file
├── tamagui.config.ts             # bundler-facing default export
└── src/
    ├── index.ts                  # public barrel
    ├── tokens/                   # colour, space, radius, typography, shadows, motion, breakpoints, z-index
    ├── theme/                    # createTokens output + light + dark themes
    ├── config.ts                 # createTamagui call (returns the live config)
    ├── provider/ui-provider.tsx  # <UIProvider> — the apps' single mount point
    ├── components/               # Box, Stack, Text, Pressable, Button, Card, Input, Spinner, Icon
    ├── test-utils/               # renderWithProvider() + vitest setup
    └── *.test.ts(x)              # contract tests, colocated with sources
```

## Token taxonomy

| File             | Tokens                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| `colors.ts`      | Palette ramps (neutral, teal, violet, green, amber, red, blue) + 28 semantic slot keys                           |
| `space.ts`       | 15-step px-aligned scale (`$0` → `$24`)                                                                          |
| `radius.ts`      | 9 radii (`none`, `xs`, `sm`, `md`, `lg`, `xl`, `2xl`, `pill`, `circle`)                                          |
| `typography.ts`  | 3 font stacks, 12-step font size scale, 4 weights, 12-step line-height scale, 3 letter-spacings, 8 text variants |
| `shadows.ts`     | 5 elevation tiers (web `boxShadow` + RN `shadow*` tuple per tier)                                                |
| `motion.ts`      | 5 durations, 5 easings                                                                                           |
| `breakpoints.ts` | 6 breakpoints + Tamagui-shaped `media` map                                                                       |
| `z-index.ts`     | 11-layer stack (hide → tooltip)                                                                                  |

## Component inventory

| Component   | Variants                                                                             | Sizes                    | Notes                                                          |
| ----------- | ------------------------------------------------------------------------------------ | ------------------------ | -------------------------------------------------------------- |
| `Box`       | none (raw layout primitive)                                                          | n/a                      | Re-export of Tamagui's `View`                                  |
| `Stack`     | `Stack`, `XStack`, `YStack`                                                          | n/a                      | Layout primitives; XStack defaults to row, YStack to column    |
| `Text`      | `display`, `title`, `subtitle`, `body`, `bodySmall`, `caption`, `label`, `monospace` | inherit                  | `tone` and `weight` props for one-off tweaks                   |
| `Pressable` | `default`, `ghost`                                                                   | inherit                  | Cross-platform press target                                    |
| `Button`    | `primary`, `secondary`, `ghost`, `destructive`                                       | `sm`/`md`/`lg`           | `loading` swaps label for spinner, `disabled` blocks `onPress` |
| `Card`      | `surface`, `elevated`, `outlined`                                                    | inherit                  | Surface primitive                                              |
| `Input`     | (single visual mode + `error` flag)                                                  | `sm`/`md`/`lg`           | `label` / `helperText` / `errorText` slots                     |
| `Spinner`   | none                                                                                 | `sm`/`md`/`lg`           | Token-driven loading indicator                                 |
| `Icon`      | none (registry pattern)                                                              | `xs`/`sm`/`md`/`lg`/`xl` | Pass any icon component via `as` prop                          |

## Usage

```tsx
import { UIProvider, Button, Text, YStack } from '@binderly/ui';

export function App() {
  return (
    <UIProvider defaultTheme="light">
      <YStack space="$4" padding="$4">
        <Text variant="title">Welcome to Binderly</Text>
        <Button label="Sign in" onPress={() => {}} />
      </YStack>
    </UIProvider>
  );
}
```

### Web (Next.js App Router)

`<UIProvider>` is a client component (`"use client"`). Mount it at
the root layout, wrap any client tree underneath. Server components
deeper in the tree can still freely use the same primitives — the
provider context is read by Tamagui only when a component reaches
for `useTheme` / `useThemeName`.

### Mobile (Expo)

Mount `<UIProvider>` once in the root component (e.g. `app/_layout.tsx`).
Tamagui's compiler swaps `react-native-web` for `react-native` at
build time; the source code is identical.

## Light + dark themes

Both themes ship from day one. Switch at runtime by passing
`defaultTheme="dark"` to `<UIProvider>`, or wrap a subtree with
Tamagui's `<Theme name="dark">` component (re-exported via
`@tamagui/core`).

To follow the OS preference, derive the theme name in your app and
re-render `<UIProvider>` with the new value.

## Iconography

`@binderly/ui` does NOT bundle an icon library. Apps install whichever
lucide flavour fits the target:

```tsx
// apps/web
import { Star, Search } from 'lucide-react';
import { Icon } from '@binderly/ui';
<Icon as={Star} size="md" color="$primary" aria-label="Favorited" />;

// apps/mobile
import { Star, Search } from 'lucide-react-native';
import { Icon } from '@binderly/ui';
<Icon as={Star} size="md" color="$primary" accessibilityLabel="Favorited" />;
```

Both lucide flavours export the same icon names with the same prop
shape (`size`, `color`, `strokeWidth`); the swap is mechanical.

For decorative icons (icons that duplicate adjacent text),
pass `aria-label="decorative"` so the icon is properly hidden
from screen readers (`role="presentation"`, `aria-hidden="true"`).

## Fonts

v1 ships **system fonts only**. The Tamagui config registers three
families (`body`, `heading`, `mono`) all bound to system stacks; no
font loader is required at app boot.

To swap in a custom font (e.g. Inter), the consuming app:

1. Installs the font (e.g. `expo-font` on mobile,
   `next/font/google` on web) and exposes the loaded family name as
   a string.
2. Builds an app-level Tamagui config that **extends** the
   `@binderly/ui` config and overrides
   `fonts: { body: { ...tamaguiConfig.fonts.body, family: '<loaded family>' } }`.
3. Passes that extended config to `<UIProvider config={...}>` (a
   future iteration will accept a `config` override; today the
   provider always uses the bundled config — escalate via
   `open-questions.md` if app teams need this before the override
   ships).

## Testing

- **Runner:** vitest (matches sibling packages).
- **Environment:** jsdom.
- **RTL:** `@testing-library/react@16` + `@testing-library/jest-dom@6`.
- **Setup:** `src/test-utils/setup.ts` registers the jest-dom
  matchers and an `afterEach(cleanup)` shim so mounted Tamagui
  providers don't leak across test cases.
- **Pattern:** every component test imports `renderWithProvider`
  from `src/test-utils/render.tsx`, which wraps RTL's `render()` in
  `<UIProvider>`.

Run from the workspace root:

```sh
pnpm --filter @binderly/ui test
pnpm --filter @binderly/ui typecheck
pnpm --filter @binderly/ui lint
pnpm --filter @binderly/ui build
```

## Decisions

- **`@tamagui/core` over the `tamagui` umbrella.** We bind production
  to `@tamagui/core` (plus `@tamagui/input` for the cross-platform
  text input). The umbrella `tamagui` package pulls
  `@tamagui/sheet`, `@tamagui/dialog`, `@tamagui/popover`, etc. —
  surface area we don't need at this phase and that complicates the
  RSC + cross-platform test story. Apps that later need a `Sheet`
  install the sub-package directly.
- **Brand colours pending.** The teal-leaning primary (`#0FA3A3`) and
  violet-leaning secondary (`#7B5DFF`) are v1 defaults chosen for
  adequate WCAG-AA contrast on both shipping themes. The
  brand-final palette swap will be tracked as Q-008 in
  `open-questions.md` once Pablo signs off.
- **No icon library bundled.** See "Iconography" above; the
  `lucide-*` peers are too heavy (each pulls `react-native-svg` +
  `react-native` peers) for a shared package.
- **Provider is `"use client"`; primitives are not.** RSC-safe
  primitives mean server components can import `<Box>`, `<Text>`,
  tokens, and themes without dragging the client boundary.
