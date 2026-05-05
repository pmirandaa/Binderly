// Wraps `@testing-library/react`'s `render` with `<UIProvider>` so
// every component test gets the Tamagui context for free.

import { render, type RenderOptions, type RenderResult } from '@testing-library/react';

import { UIProvider } from '../provider/ui-provider.js';

import type { ThemeName } from '../theme/index.js';
import type { ReactElement } from 'react';

export interface RenderWithProviderOptions extends RenderOptions {
  /** Override the initial theme. Defaults to `'light'`. */
  theme?: ThemeName;
}

export function renderWithProvider(
  ui: ReactElement,
  options: RenderWithProviderOptions = {},
): RenderResult {
  const { theme = 'light', ...rest } = options;
  return render(<UIProvider defaultTheme={theme}>{ui}</UIProvider>, rest);
}

export * from '@testing-library/react';
