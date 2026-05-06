// Vitest setup for `@binderly/web`.
//
// Matches `packages/ui`'s setup: jest-dom matchers + cleanup
// after each test. Adds a tiny matchMedia shim because Tamagui
// reads it during initial render and jsdom doesn't ship one.

import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll } from 'vitest';

// Provide dev defaults for the typed env loader so component
// tests that touch the api-client / Supabase singletons don't
// trip the missing-key fail-fast path. The `lib/env.test.ts`
// suite overrides these explicitly to assert the failure mode.
process.env['NEXT_PUBLIC_SUPABASE_URL'] = 'http://localhost:54321';
process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'anon-key';

beforeAll(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
  }
});

afterEach(() => {
  cleanup();
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.clear();
    } catch {
      // Storage might be disabled in some environments.
    }
  }
});
