// Barrel for the provider components mounted in `app/_layout.tsx`.
// Internal-to-`apps/mobile`; not part of any public surface.

export { AuthProvider, useAuth } from './AuthProvider';
export type { AuthContextValue, AuthProviderProps } from './AuthProvider';

export { EnvGate } from './EnvGate';
export type { EnvGateProps } from './EnvGate';

export { QueryProvider, createMobileQueryClient } from './QueryProvider';
export type { QueryProviderProps } from './QueryProvider';

export {
  THEME_OVERRIDE_VALUES,
  ThemeOverrideProvider,
  resolveTheme,
  useThemeOverride,
} from './ThemeOverrideProvider';
export type {
  ThemeOverride,
  ThemeOverrideContextValue,
  ThemeOverrideProviderProps,
} from './ThemeOverrideProvider';
