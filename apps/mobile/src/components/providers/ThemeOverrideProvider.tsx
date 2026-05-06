// Theme-override provider.
//
// The shell honours `useColorScheme()` by default and lets the user
// override it via a tri-state preference (`'light' | 'dark' |
// 'system'`). The override is persisted in secure-store so it
// survives an app reinstall (the bytes are encrypted at rest, but
// also: the user has consciously chosen this; we don't want it lost
// on every reinstall).
//
// The provider re-renders the children with the resolved theme name
// and exposes `useThemeOverride()` so settings UI can flip the
// preference. Resolution rules:
//
//   override === 'system' → useColorScheme() (or 'light' if null)
//   override === 'light'  → 'light'
//   override === 'dark'   → 'dark'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme } from 'react-native';

import { UIProvider, type ThemeName } from '@binderly/ui';

import {
  SECURE_STORAGE_KEYS,
  getSecureStorage,
  type SecureStorage,
} from '../../lib/secure-storage';

export const THEME_OVERRIDE_VALUES = ['system', 'light', 'dark'] as const;
export type ThemeOverride = (typeof THEME_OVERRIDE_VALUES)[number];

export interface ThemeOverrideContextValue {
  /** The stored override, hydrated from secure-store on mount. */
  readonly override: ThemeOverride;
  /** The resolved theme actually applied to the UIProvider. */
  readonly resolved: ThemeName;
  /** True until the secure-store hydration completes. */
  readonly hydrating: boolean;
  /** Persist a new override and update the resolved theme. */
  setOverride(next: ThemeOverride): Promise<void>;
}

const ThemeOverrideContext = createContext<ThemeOverrideContextValue | null>(null);

export interface ThemeOverrideProviderProps {
  children: ReactNode;
  /**
   * Optional storage override (tests inject an in-memory adapter).
   * Defaults to the live secure-store singleton.
   */
  storage?: SecureStorage;
  /**
   * Optional initial override. Useful for tests + Storybook to skip
   * the hydration roundtrip.
   */
  initialOverride?: ThemeOverride;
}

function isThemeOverride(value: unknown): value is ThemeOverride {
  return typeof value === 'string' && (THEME_OVERRIDE_VALUES as readonly string[]).includes(value);
}

function resolveTheme(
  override: ThemeOverride,
  system: 'light' | 'dark' | null | undefined,
): ThemeName {
  if (override === 'light' || override === 'dark') return override;
  return system === 'dark' ? 'dark' : 'light';
}

export function ThemeOverrideProvider(props: ThemeOverrideProviderProps): ReactNode {
  const { children, storage, initialOverride } = props;
  const storageInstance = storage ?? getSecureStorage();

  const [override, setOverrideState] = useState<ThemeOverride>(initialOverride ?? 'system');
  const [hydrating, setHydrating] = useState(initialOverride === undefined);
  const systemScheme = useColorScheme();

  // Hydrate the persisted preference exactly once on mount.
  useEffect(() => {
    if (initialOverride !== undefined) return;
    let cancelled = false;
    storageInstance
      .getItem(SECURE_STORAGE_KEYS.themeOverride)
      .then((value) => {
        if (cancelled) return;
        if (isThemeOverride(value)) setOverrideState(value);
        setHydrating(false);
      })
      .catch(() => {
        if (cancelled) return;
        setHydrating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialOverride, storageInstance]);

  const setOverride = useCallback(
    async (next: ThemeOverride) => {
      setOverrideState(next);
      await storageInstance.setItem(SECURE_STORAGE_KEYS.themeOverride, next);
    },
    [storageInstance],
  );

  const resolved = useMemo(() => resolveTheme(override, systemScheme), [override, systemScheme]);

  const value = useMemo<ThemeOverrideContextValue>(
    () => ({ override, resolved, hydrating, setOverride }),
    [override, resolved, hydrating, setOverride],
  );

  return (
    <ThemeOverrideContext.Provider value={value}>
      <UIProvider defaultTheme={resolved}>{children}</UIProvider>
    </ThemeOverrideContext.Provider>
  );
}

export function useThemeOverride(): ThemeOverrideContextValue {
  const value = useContext(ThemeOverrideContext);
  if (value === null) {
    throw new Error(
      'useThemeOverride(): no <ThemeOverrideProvider> found in the tree. Mount it in app/_layout.tsx.',
    );
  }
  return value;
}

export { resolveTheme };
