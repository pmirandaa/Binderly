// `apps/web/app/c/themes` — public shareable theming barrel.
// T-SH-THEMES.
//
// Consumers:
//   - `apps/web/components/share/ShareableView.tsx` — wraps the render
//     in `<ShareableThemeProvider>` + reads the resolved `Theme`.
//   - `apps/web/app/settings/shareables/ShareableRowEditor.tsx` —
//     renders the gated `<ThemePicker>`.
//   - the OG worker (follow-up) — `ogPaletteForTheme`.

export {
  THEMES,
  THEME_LIST,
  DEFAULT_THEME,
  resolveTheme,
  resolvePublicTheme,
  type Theme,
} from './registry';
export { ShareableThemeProvider, type ShareableThemeProviderProps } from './ShareableThemeProvider';
export { ThemeSwatch, type ThemeSwatchProps } from './ThemeSwatch';
export { ThemePicker, type ThemePickerProps } from './ThemePicker';
export { ogPaletteForTheme, type OgPalette } from './og-palette';
