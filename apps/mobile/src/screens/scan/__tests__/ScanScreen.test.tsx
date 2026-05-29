// Additional ScanScreen tests — session footer, stack panel,
// and auth-gate redirect.
//
// All mocks follow the same pattern as `../ScanScreen.test.tsx`
// to avoid the supabase → expo-modules-core import chain.

import { waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMatchSink, createMatchQueue } from '../../../scanner/match/index.js';
import { renderWithProvider } from '../../../test-utils/render.js';
import { setMockCameraPermission } from '../../../test-utils/setup.js';
import { ScanScreen } from '../ScanScreen.js';

import type { LoadModelsFn } from '../use-model-loader.js';

// ============================================================
// Mock ProtectedScreen to simulate auth redirect
// ============================================================

const { mockReplace } = vi.hoisted(() => ({ mockReplace: vi.fn() }));

vi.mock('../../../lib/auth/index.js', () => ({
  ProtectedScreen: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DEFAULT_SIGN_IN_ROUTE: '/auth/sign-in',
  useRequireAuth: vi.fn(() => ({ loading: false, authenticated: true })),
}));

// FU-57: `useGate('stack_scanner')` reads the RC entitlement snapshot.
// Default to Pro so the continuous-scan session footer / stack-review
// path these tests cover stays active.
vi.mock('../../../billing/index.js', () => ({
  useEntitlementsQuery: () => ({ data: { tier: 'pro' }, isPending: false }),
}));

vi.mock('../../../lib/api-client.js', () => ({
  useApiClient: vi.fn(() => ({
    collection: {
      addCollectionItem: vi.fn(async (input: { printingId: string }) => ({
        id: `cid-${input.printingId}`,
        printingId: input.printingId,
        quantity: 1,
        source: 'scan',
      })),
      deleteCollectionItem: vi.fn(async () => undefined),
    },
  })),
  ApiClientProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ============================================================
// useScanner mock
// ============================================================


const mockSink = createMatchSink();
const mockQueue = createMatchQueue();

vi.mock('../../../scanner/match/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../scanner/match/index.js')>();
  return {
    ...original,
    useScanner: vi.fn(() => ({
      sink: mockSink,
      queue: mockQueue,
      isMatching: false,
      config: original.MATCH_DEFAULTS,
    })),
  };
});

// ============================================================
// Router mock
// ============================================================

vi.mock('expo-router', () => ({
  Slot: ({ children }: { children?: React.ReactNode }) => children ?? null,
  Stack: Object.assign(
    ({ children }: { children?: React.ReactNode }) => children ?? null,
    { Screen: ({ children }: { children?: React.ReactNode }) => children ?? null },
  ),
  Tabs: Object.assign(
    ({ children }: { children?: React.ReactNode }) => children ?? null,
    { Screen: ({ children }: { children?: React.ReactNode }) => children ?? null },
  ),
  Link: ({ children }: { children?: React.ReactNode }) => children ?? null,
  Redirect: () => null,
  useFocusEffect: vi.fn((callback: () => void | (() => void)) => {
    React.useEffect(() => {
      const cleanup = callback();
      return cleanup ?? undefined;
    }, [callback]);
  }),
  router: { push: vi.fn(), replace: mockReplace, back: vi.fn(), canGoBack: () => true },
  useRouter: () => ({ push: vi.fn(), replace: mockReplace, back: vi.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({}),
  useSegments: () => [],
  usePathname: () => '/',
}));

// ============================================================
// Helpers
// ============================================================

const STUB_LOAD_MODELS: LoadModelsFn = async () => ({
  embedModel: {
    embeddingDim: 128,
    delegate: 'cpu' as const,
    isUsingGpu: false,
    modelName: 'stub',
    modelVersion: '0.0.0',
    embed: async () => new Float32Array(128),
    dispose: vi.fn(),
  },
  annIndex: {
    dim: 128,
    count: 0,
    format: 'flat' as const,
    metric: 'cosine' as const,
    dtype: 'float32' as const,
    name: 'stub',
    version: '0.0.0',
    embeddingModelName: 'stub',
    embeddingModelVersion: '0.0.0',
    embeddingModelHash: '',
    searchKNN: () => [],
    dispose: vi.fn(),
  },
});

beforeEach(() => {
  mockReplace.mockClear();
  mockSink.clear();
  mockQueue.clear();
});

afterEach(() => {
  mockReplace.mockClear();
});

// ============================================================
// Tests
// ============================================================

describe('<ScanScreen> — scanner-loading / error', () => {
  it('shows loading while models are pending', () => {
    const neverResolve: LoadModelsFn = () => new Promise(() => {});
    setMockCameraPermission('granted');
    const view = renderWithProvider(<ScanScreen loadModels={neverResolve} />);
    expect(view.queryByTestId('scanner-loading')).not.toBeNull();
  });

  it('transitions away from loading once models resolve', async () => {
    setMockCameraPermission('granted');
    const view = renderWithProvider(<ScanScreen loadModels={STUB_LOAD_MODELS} />);
    await waitFor(() => {
      expect(view.queryByTestId('scanner-loading')).toBeNull();
    });
  });

  it('shows scanner-error when load fails', async () => {
    const failLoad: LoadModelsFn = async () => {
      throw new Error('bad index');
    };
    setMockCameraPermission('granted');
    const view = renderWithProvider(<ScanScreen loadModels={failLoad} />);
    await waitFor(() => {
      expect(view.queryByTestId('scanner-error')).not.toBeNull();
    });
  });

  it('includes error copy in scanner-error', async () => {
    const failLoad: LoadModelsFn = async () => {
      throw new Error('index too large');
    };
    setMockCameraPermission('granted');
    const view = renderWithProvider(<ScanScreen loadModels={failLoad} />);
    await waitFor(() => {
      expect(view.container.textContent).toContain('index too large');
    });
  });

  it('shows retry button in scanner-error', async () => {
    const failLoad: LoadModelsFn = async () => {
      throw new Error('load fail');
    };
    setMockCameraPermission('granted');
    const view = renderWithProvider(<ScanScreen loadModels={failLoad} />);
    await waitFor(() => {
      expect(view.queryByTestId('scanner-error-retry')).not.toBeNull();
    });
  });
});

describe('<ScanScreen> — session footer hidden until items added', () => {
  it('session footer is absent before any auto-add', async () => {
    setMockCameraPermission('granted');
    const view = renderWithProvider(<ScanScreen loadModels={STUB_LOAD_MODELS} />);
    await waitFor(() => {
      expect(view.queryByTestId('scanner-loading')).toBeNull();
    });
    expect(view.queryByTestId('session-footer')).toBeNull();
  });
});

describe('<ScanScreen> — undo toast absent on fresh mount', () => {
  it('no undo toast visible on fresh mount', async () => {
    setMockCameraPermission('granted');
    const view = renderWithProvider(<ScanScreen loadModels={STUB_LOAD_MODELS} />);
    await waitFor(() => {
      expect(view.queryByTestId('scanner-loading')).toBeNull();
    });
    expect(view.queryByTestId('undo-toast')).toBeNull();
  });
});
