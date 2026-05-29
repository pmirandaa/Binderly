'use client';

// SSR-safe theme renderer for the public shareable page.
//
// Wraps the page content in a themed root that paints the resolved
// palette: it sets the background + base text colour + body font on a
// plain `<div>` and exposes every token as a `--share-*` CSS variable
// so descendants can opt into theme colours without prop-drilling.
// A `band`-header theme renders a thin accent strip across the top.
//
// Pure render — no effects, no browser-only APIs — so it renders
// identically during Next.js SSR and on the client.

import { createContext, useContext } from 'react';

import type { Theme } from './registry';
import type { CSSProperties, ReactNode } from 'react';

const ShareableThemeContext = createContext<Theme | null>(null);

/** Read the active shareable theme. Throws outside a provider. */
export function useShareableTheme(): Theme {
  const theme = useContext(ShareableThemeContext);
  if (theme === null) {
    throw new Error('useShareableTheme must be used within a <ShareableThemeProvider>');
  }
  return theme;
}

export interface ShareableThemeProviderProps {
  readonly theme: Theme;
  readonly children: ReactNode;
}

function themeCssVars(theme: Theme): Record<string, string> {
  return {
    '--share-bg': theme.palette.background,
    '--share-surface': theme.palette.surface,
    '--share-surface-muted': theme.palette.surfaceMuted,
    '--share-border': theme.palette.border,
    '--share-text': theme.palette.text,
    '--share-text-muted': theme.palette.textMuted,
    '--share-accent': theme.palette.accent,
    '--share-on-accent': theme.palette.onAccent,
    '--share-font-heading': theme.fonts.heading,
    '--share-font-body': theme.fonts.body,
  };
}

export function ShareableThemeProvider({
  theme,
  children,
}: ShareableThemeProviderProps): ReactNode {
  const rootStyle: CSSProperties = {
    backgroundColor: theme.palette.background,
    color: theme.palette.text,
    fontFamily: theme.fonts.body,
    minHeight: '100%',
    ...(themeCssVars(theme) as CSSProperties),
  };

  return (
    <ShareableThemeContext.Provider value={theme}>
      <div
        data-share-theme={theme.id}
        data-card-frame={theme.cardFrame}
        data-header-treatment={theme.header}
        style={rootStyle}
      >
        {theme.header === 'band' ? (
          <div
            data-testid="share-theme-band"
            aria-hidden="true"
            style={{ height: 6, backgroundColor: theme.palette.accent, width: '100%' }}
          />
        ) : null}
        {children}
      </div>
    </ShareableThemeContext.Provider>
  );
}
