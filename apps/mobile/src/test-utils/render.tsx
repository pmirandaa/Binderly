// Test-render helpers. The shell's contract tests render Tamagui
// primitives in jsdom (same posture as `@binderly/ui`); routes
// that render `expo-router` exports import the screen components
// from `src/screens/` directly, sidestepping the routing layer.

import { render, type RenderOptions, type RenderResult } from '@testing-library/react';

import { UIProvider } from '@binderly/ui';

import type { ReactElement, ReactNode } from 'react';

interface ProviderProps {
  children: ReactNode;
}

function ProviderTree({ children }: ProviderProps): ReactNode {
  return <UIProvider defaultTheme="light">{children}</UIProvider>;
}

/**
 * Render a node wrapped in `<UIProvider>` so Tamagui tokens
 * resolve in tests. Mirrors `packages/ui`'s test posture.
 */
export function renderWithProvider(ui: ReactElement, options?: RenderOptions): RenderResult {
  return render(ui, { wrapper: ProviderTree, ...options });
}

export { ProviderTree };
