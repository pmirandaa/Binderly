import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Text } from '@binderly/ui';

import { THEME_NAMES, THEME_STORAGE_KEY, UIProvider, useTheme } from './UIProvider';

import type { ReactNode } from 'react';

function ThemeReadout(): ReactNode {
  const { theme, toggleTheme } = useTheme();
  return (
    <>
      <Text data-testid="theme-readout">{theme}</Text>
      <button type="button" onClick={toggleTheme} data-testid="toggle">
        toggle
      </button>
    </>
  );
}

describe('UIProvider', () => {
  it('renders children inside the Tamagui provider', () => {
    render(
      <UIProvider>
        <Text data-testid="child">hello</Text>
      </UIProvider>,
    );
    expect(screen.getByTestId('child')).toHaveTextContent('hello');
  });

  it('exposes a theme context with default light theme', () => {
    const wrapper = ({ children }: { children: ReactNode }) => <UIProvider>{children}</UIProvider>;
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme).toBe('light');
  });

  it('persists theme toggles to localStorage and applies data-theme', async () => {
    const user = userEvent.setup();
    render(
      <UIProvider>
        <ThemeReadout />
      </UIProvider>,
    );
    expect(screen.getByTestId('theme-readout')).toHaveTextContent('light');
    await user.click(screen.getByTestId('toggle'));
    expect(screen.getByTestId('theme-readout')).toHaveTextContent('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('reads persisted theme from localStorage on mount', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    render(
      <UIProvider>
        <ThemeReadout />
      </UIProvider>,
    );
    expect(screen.getByTestId('theme-readout')).toHaveTextContent('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('ignores invalid persisted values', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'neon');
    render(
      <UIProvider>
        <ThemeReadout />
      </UIProvider>,
    );
    // Falls back to OS preference (matchMedia stub returns matches:false → light).
    expect(screen.getByTestId('theme-readout')).toHaveTextContent('light');
  });

  it('throws if useTheme is called outside the provider', () => {
    expect(() => renderHook(() => useTheme())).toThrow(/useTheme must be used inside <UIProvider>/);
  });

  it('exposes setTheme for explicit selection', () => {
    const wrapper = ({ children }: { children: ReactNode }) => <UIProvider>{children}</UIProvider>;
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => result.current.setTheme('dark'));
    expect(result.current.theme).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('exports both theme names', () => {
    expect(THEME_NAMES).toEqual(['light', 'dark']);
  });
});
