'use client';

// App-level UI provider. Wraps `@binderly/ui`'s `<UIProvider>` and
// adds:
//
//   - Theme resolution: localStorage override > prefers-color-scheme
//     > 'light' default. Persists user toggle to localStorage.
//   - A React context exposing `{ theme, setTheme, toggleTheme }`
//     so any client component can flip the active theme.
//
// The provider must be `"use client"` because Tamagui's underlying
// provider mounts a context. RSC content rendered as `children` is
// wrapped only when it crosses into the client tree.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { UIProvider as BinderlyUIProvider, type ThemeName } from '@binderly/ui';

const STORAGE_KEY = 'binderly:theme';
const THEME_NAMES: readonly ThemeName[] = ['light', 'dark'] as const;

export interface ThemeContextValue {
  theme: ThemeName;
  setTheme: (next: ThemeName) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface UIProviderProps {
  children: ReactNode;
  /**
   * Initial theme used during the first server render. Browsers
   * read the persisted value on mount and may flip it; the small
   * inline boot script (rendered in `app/layout.tsx`) sets
   * `data-theme` on `<html>` synchronously to avoid flash.
   */
  initialTheme?: ThemeName;
}

export function UIProvider({ children, initialTheme = 'light' }: UIProviderProps): ReactNode {
  const [theme, setThemeState] = useState<ThemeName>(initialTheme);

  // Read persisted preference once on mount; if absent, fall back
  // to the OS-level prefers-color-scheme media query.
  useEffect(() => {
    try {
      const persisted = readPersistedTheme();
      if (persisted !== null) {
        setThemeState(persisted);
        applyDocumentTheme(persisted);
        return;
      }
      const media = window.matchMedia?.('(prefers-color-scheme: dark)');
      const initial = media?.matches === true ? 'dark' : 'light';
      setThemeState(initial);
      applyDocumentTheme(initial);
    } catch {
      // No window / matchMedia / localStorage — fall through with
      // the SSR initial value.
    }
  }, []);

  const setTheme = useCallback((next: ThemeName) => {
    setThemeState(next);
    persistTheme(next);
    applyDocumentTheme(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((current) => {
      const next: ThemeName = current === 'light' ? 'dark' : 'light';
      persistTheme(next);
      applyDocumentTheme(next);
      return next;
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme],
  );

  return (
    <ThemeContext.Provider value={value}>
      <BinderlyUIProvider defaultTheme={theme}>{children}</BinderlyUIProvider>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx === null) {
    throw new Error('useTheme must be used inside <UIProvider>.');
  }
  return ctx;
}

function readPersistedTheme(): ThemeName | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    return THEME_NAMES.includes(raw as ThemeName) ? (raw as ThemeName) : null;
  } catch {
    return null;
  }
}

function persistTheme(theme: ThemeName): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage may be disabled (private browsing). Best effort.
  }
}

function applyDocumentTheme(theme: ThemeName): void {
  try {
    const root = window.document?.documentElement;
    if (root === undefined) return;
    root.dataset['theme'] = theme;
  } catch {
    // No window.document — SSR or disabled DOM.
  }
}

export { STORAGE_KEY as THEME_STORAGE_KEY, THEME_NAMES };
export type { ThemeName };
