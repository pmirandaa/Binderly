import { act, render, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { resolveTheme, ThemeOverrideProvider, useThemeOverride } from './ThemeOverrideProvider';
import { createInMemorySecureStorage, SECURE_STORAGE_KEYS } from '../../lib/secure-storage';
import { setMockColorScheme } from '../../test-utils/setup';

describe('resolveTheme', () => {
  it('returns the override directly for explicit light/dark', () => {
    expect(resolveTheme('light', 'dark')).toBe('light');
    expect(resolveTheme('dark', 'light')).toBe('dark');
  });

  it('falls back to system when override is system', () => {
    expect(resolveTheme('system', 'dark')).toBe('dark');
    expect(resolveTheme('system', 'light')).toBe('light');
  });

  it('defaults to light when override is system and system is unknown', () => {
    expect(resolveTheme('system', null)).toBe('light');
    expect(resolveTheme('system', undefined)).toBe('light');
  });
});

describe('<ThemeOverrideProvider>', () => {
  it('starts in system mode and applies useColorScheme()', async () => {
    setMockColorScheme('dark');
    const storage = createInMemorySecureStorage();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ThemeOverrideProvider storage={storage}>{children}</ThemeOverrideProvider>
    );
    const { result } = renderHook(() => useThemeOverride(), { wrapper });
    await waitFor(() => expect(result.current.hydrating).toBe(false));
    expect(result.current.override).toBe('system');
    expect(result.current.resolved).toBe('dark');
  });

  it('hydrates the persisted override from secure-store', async () => {
    setMockColorScheme('light');
    const storage = createInMemorySecureStorage();
    await storage.setItem(SECURE_STORAGE_KEYS.themeOverride, 'dark');
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ThemeOverrideProvider storage={storage}>{children}</ThemeOverrideProvider>
    );
    const { result } = renderHook(() => useThemeOverride(), { wrapper });
    await waitFor(() => expect(result.current.override).toBe('dark'));
    expect(result.current.resolved).toBe('dark');
  });

  it('persists a setOverride call to secure-store', async () => {
    setMockColorScheme('light');
    const storage = createInMemorySecureStorage();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ThemeOverrideProvider storage={storage}>{children}</ThemeOverrideProvider>
    );
    const { result } = renderHook(() => useThemeOverride(), { wrapper });
    await waitFor(() => expect(result.current.hydrating).toBe(false));
    await act(async () => {
      await result.current.setOverride('dark');
    });
    expect(result.current.override).toBe('dark');
    expect(result.current.resolved).toBe('dark');
    expect(await storage.getItem(SECURE_STORAGE_KEYS.themeOverride)).toBe('dark');
  });

  it('round-trips through every override value', async () => {
    setMockColorScheme('light');
    const storage = createInMemorySecureStorage();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ThemeOverrideProvider storage={storage}>{children}</ThemeOverrideProvider>
    );
    const { result } = renderHook(() => useThemeOverride(), { wrapper });
    await waitFor(() => expect(result.current.hydrating).toBe(false));
    for (const value of ['light', 'dark', 'system'] as const) {
      await act(async () => {
        await result.current.setOverride(value);
      });
      expect(result.current.override).toBe(value);
      expect(await storage.getItem(SECURE_STORAGE_KEYS.themeOverride)).toBe(value);
    }
  });

  it('ignores an unrecognized stored override and resets to system', async () => {
    setMockColorScheme('light');
    const storage = createInMemorySecureStorage();
    await storage.setItem(SECURE_STORAGE_KEYS.themeOverride, 'cosmic-dark' as never);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ThemeOverrideProvider storage={storage}>{children}</ThemeOverrideProvider>
    );
    const { result } = renderHook(() => useThemeOverride(), { wrapper });
    await waitFor(() => expect(result.current.hydrating).toBe(false));
    expect(result.current.override).toBe('system');
  });

  it('skips hydration when initialOverride is provided', () => {
    setMockColorScheme('light');
    const storage = createInMemorySecureStorage();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ThemeOverrideProvider storage={storage} initialOverride="dark">
        {children}
      </ThemeOverrideProvider>
    );
    const { result } = renderHook(() => useThemeOverride(), { wrapper });
    expect(result.current.hydrating).toBe(false);
    expect(result.current.override).toBe('dark');
  });

  it('renders children inside the UIProvider tree', async () => {
    setMockColorScheme('light');
    const storage = createInMemorySecureStorage();
    const result = render(
      <ThemeOverrideProvider storage={storage} initialOverride="light">
        <span data-testid="leaf">leaf</span>
      </ThemeOverrideProvider>,
    );
    expect(result.getByTestId('leaf').textContent).toBe('leaf');
  });

  it('throws when useThemeOverride is called without a provider', () => {
    expect(() => renderHook(() => useThemeOverride())).toThrowError(/<ThemeOverrideProvider>/);
  });
});
