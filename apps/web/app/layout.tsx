// Root layout for `apps/web`.
//
// Mounts the full provider tree (Tamagui UI, TanStack Query,
// Supabase auth, error boundary). Tamagui CSS is flushed via
// `tamaguiConfig.getCSS()` in `<head>` so SSR markup arrives
// styled and React's hydration doesn't flicker. A small inline
// boot script reads `localStorage` synchronously to set the
// `data-theme` attribute before React mounts.

import { tamaguiConfig } from '@binderly/ui/tamagui.config';

import { ErrorBoundary } from '../components/error/ErrorBoundary';
import { AuthProvider } from '../components/providers/AuthProvider';
import { QueryProvider } from '../components/providers/QueryProvider';
import { THEME_STORAGE_KEY, UIProvider } from '../components/providers/UIProvider';

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Binderly',
  description:
    'Binderly — collection-first Pokémon TCG tracker. Browse sets, track your collection, share what you own.',
  applicationName: 'Binderly',
  authors: [{ name: 'Binderly' }],
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0b0d' },
  ],
};

const themeBootScript = `
(function () {
  try {
    var stored = window.localStorage.getItem('${THEME_STORAGE_KEY}');
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme = stored === 'dark' || stored === 'light' ? stored : (prefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) { /* noop */ }
})();
`.trim();

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <style id="tamagui-css" dangerouslySetInnerHTML={{ __html: tamaguiConfig.getCSS() }} />
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>
        <UIProvider>
          <QueryProvider>
            <AuthProvider>
              <ErrorBoundary>{children}</ErrorBoundary>
            </AuthProvider>
          </QueryProvider>
        </UIProvider>
      </body>
    </html>
  );
}
