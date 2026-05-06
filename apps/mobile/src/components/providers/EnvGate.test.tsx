import { describe, expect, it, vi } from 'vitest';

import { EnvGate } from './EnvGate';
import { MobileEnvError, type MobileEnv } from '../../lib/env';
import { renderWithProvider } from '../../test-utils/render';

const validSource = {
  EXPO_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon',
} as const;

describe('<EnvGate>', () => {
  it('renders children with the resolved env when valid', () => {
    const childRenderer = vi.fn((env: MobileEnv) => <>{env.supabaseUrl}</>);
    const result = renderWithProvider(<EnvGate source={validSource}>{childRenderer}</EnvGate>);
    expect(childRenderer).toHaveBeenCalledTimes(1);
    expect(childRenderer.mock.calls[0]?.[0]?.supabaseUrl).toBe('https://abc.supabase.co');
    expect(result.container.textContent).toContain('https://abc.supabase.co');
  });

  it('renders the default fallback when required env is missing', () => {
    const childRenderer = vi.fn(() => <>should-not-render</>);
    const result = renderWithProvider(<EnvGate source={{}}>{childRenderer}</EnvGate>);
    expect(childRenderer).not.toHaveBeenCalled();
    expect(result.container.textContent).toMatch(/Configuration error/);
    expect(result.container.textContent).toContain('EXPO_PUBLIC_SUPABASE_URL');
    expect(result.container.textContent).toContain('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  });

  it('uses the fallback prop when provided', () => {
    const fallback = vi.fn((error: MobileEnvError) => <>custom-fallback-{error.missing.length}</>);
    const result = renderWithProvider(
      <EnvGate source={{}} fallback={fallback}>
        {() => <>should-not-render</>}
      </EnvGate>,
    );
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(fallback.mock.calls[0]?.[0]).toBeInstanceOf(MobileEnvError);
    expect(result.container.textContent).toContain('custom-fallback-2');
  });
});
