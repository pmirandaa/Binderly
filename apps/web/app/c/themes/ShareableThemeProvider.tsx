// `<ShareableThemeProvider>` — SSR-safe theme frame for the public
// shareable page. T-SH-THEMES.
//
// Wraps the public render body in a frame element that paints the
// theme's background, base text colour, and font-family. Deliberately
// free of any client-only API (no `useEffect`, no `window`, no
// `useState`) so it renders identically on the server and the client —
// the public page is `force-dynamic` SSR and any hydration mismatch
// would flash an unstyled frame to crawlers + first paint.
//
// The provider does NOT use React context: the handful of descendants
// that need per-element colours (`<ShareableView>`'s header / cards)
// read the resolved `Theme` directly as a prop. Keeping the token flow
// explicit avoids a context round-trip and keeps the provider a pure
// presentational wrapper.

import { YStack } from '@binderly/ui';

import type { Theme } from './registry';
import type { ReactNode } from 'react';

export interface ShareableThemeProviderProps {
  readonly theme: Theme;
  readonly children: ReactNode;
}

export function ShareableThemeProvider({
  theme,
  children,
}: ShareableThemeProviderProps): ReactNode {
  return (
    <YStack
      flex={1}
      minHeight="100%"
      backgroundColor={theme.background}
      data-testid="shareable-theme-frame"
      data-theme={theme.id}
      style={{ fontFamily: theme.fontFamily, color: theme.text }}
    >
      {children}
    </YStack>
  );
}
