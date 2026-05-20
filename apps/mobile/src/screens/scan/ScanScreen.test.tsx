// Updated by T-SC-UX: the prior stub ScanScreen has been replaced
// with the full continuous-scan screen. These tests mock ProtectedScreen
// and useApiClient to avoid the supabase → expo-modules-core chain.
// Detailed overlay/disambig/stack tests live in __tests__/ScanScreen.test.tsx.

import { act, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ScanScreen } from './ScanScreen.js';
import { createMatchSink, createMatchQueue } from '../../scanner/match/index.js';
import { renderWithProvider } from '../../test-utils/render.js';
import { setMockCameraPermission } from '../../test-utils/setup.js';

import type { LoadModelsFn } from './use-model-loader.js';

// ============================================================
// Mock ProtectedScreen to render children (authenticated path)
// ============================================================

vi.mock('../../lib/auth/index.js', () => ({
  ProtectedScreen: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DEFAULT_SIGN_IN_ROUTE: '/auth/sign-in',
  useRequireAuth: vi.fn(() => ({ loading: false, authenticated: true })),
}));

// ============================================================
// Mock useApiClient to return a stub client
// ============================================================

const mockAddCollectionItem = vi.fn(async (input: { printingId: string }) => ({
  id: `cid-${input.printingId}`,
  printingId: input.printingId,
  quantity: 1,
  source: 'scan',
}));

const mockDeleteCollectionItem = vi.fn(async () => undefined);

vi.mock('../../lib/api-client.js', () => ({
  useApiClient: vi.fn(() => ({
    collection: {
      addCollectionItem: mockAddCollectionItem,
      deleteCollectionItem: mockDeleteCollectionItem,
    },
  })),
  ApiClientProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ============================================================
// Mock useScanner
// ============================================================


const mockSink = createMatchSink();
const mockQueue = createMatchQueue();

vi.mock('../../scanner/match/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../scanner/match/index.js')>();
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

const { routerMocks } = vi.hoisted(() => ({
  routerMocks: {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    canGoBack: vi.fn(() => true),
  },
}));

vi.mock('expo-router', () => {
  const Slot = ({ children }: { children?: React.ReactNode }) => children ?? null;
  const Stack = Object.assign(
    ({ children }: { children?: React.ReactNode }) => children ?? null,
    { Screen: ({ children }: { children?: React.ReactNode }) => children ?? null },
  );
  const Tabs = Object.assign(
    ({ children }: { children?: React.ReactNode }) => children ?? null,
    { Screen: ({ children }: { children?: React.ReactNode }) => children ?? null },
  );
  return {
    Slot,
    Stack,
    Tabs,
    Link: ({ children }: { children?: React.ReactNode }) => children ?? null,
    Redirect: () => null,
    useFocusEffect: vi.fn((callback: () => void | (() => void)) => {
      React.useEffect(() => {
        const cleanup = callback();
        return cleanup ?? undefined;
      }, [callback]);
    }),
    router: routerMocks,
    useRouter: () => routerMocks,
    useLocalSearchParams: () => ({}),
    useSegments: () => [],
    usePathname: () => '/',
  };
});

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
  routerMocks.push.mockClear();
  routerMocks.replace.mockClear();
  routerMocks.back.mockClear();
  routerMocks.canGoBack.mockReturnValue(true);
  mockSink.clear();
  mockQueue.clear();
  mockAddCollectionItem.mockClear();
  mockDeleteCollectionItem.mockClear();
});

describe('<ScanScreen>', () => {
  it('shows the pre-prompt when permission is `not-determined`', async () => {
    setMockCameraPermission('not-determined');
    const view = renderWithProvider(<ScanScreen loadModels={STUB_LOAD_MODELS} />);

    await waitFor(() => {
      expect(view.queryByTestId('scanner-loading')).toBeNull();
      expect(view.queryByTestId('camera-permission-prompt')).not.toBeNull();
    });
    expect(view.queryByTestId('scan-camera-preview')).toBeNull();
  });

  it('shows the camera preview once permission is granted', async () => {
    setMockCameraPermission('granted');
    const view = renderWithProvider(<ScanScreen loadModels={STUB_LOAD_MODELS} />);

    await waitFor(() => {
      expect(view.queryByTestId('camera-permission-prompt')).toBeNull();
      expect(view.queryByTestId('scan-camera-preview')).not.toBeNull();
    });
  });

  it('shows the denied-branch copy when permission is denied', async () => {
    setMockCameraPermission('denied');
    const view = renderWithProvider(<ScanScreen loadModels={STUB_LOAD_MODELS} />);

    await waitFor(() => {
      expect(view.queryByTestId('camera-permission-prompt')).not.toBeNull();
      expect(view.container.textContent).toContain('Camera access is turned off');
    });
  });

  it('renders a Close button', async () => {
    setMockCameraPermission('granted');
    const view = renderWithProvider(<ScanScreen loadModels={STUB_LOAD_MODELS} />);

    await waitFor(() => {
      expect(view.queryByTestId('scan-screen-close')).not.toBeNull();
    });
  });

  it('calls router.back() when Close is clicked and history exists', async () => {
    setMockCameraPermission('granted');
    const view = renderWithProvider(<ScanScreen loadModels={STUB_LOAD_MODELS} />);

    await waitFor(() => {
      expect(view.queryByTestId('scan-screen-close')).not.toBeNull();
    });

    fireEvent.click(view.getByTestId('scan-screen-close'));
    expect(routerMocks.back).toHaveBeenCalledTimes(1);
    expect(routerMocks.replace).not.toHaveBeenCalled();
  });

  it('falls back to router.replace("/") when there is no history', async () => {
    routerMocks.canGoBack.mockReturnValue(false);
    setMockCameraPermission('granted');
    const view = renderWithProvider(<ScanScreen loadModels={STUB_LOAD_MODELS} />);

    await waitFor(() => {
      expect(view.queryByTestId('scan-screen-close')).not.toBeNull();
    });

    fireEvent.click(view.getByTestId('scan-screen-close'));
    expect(routerMocks.back).not.toHaveBeenCalled();
    expect(routerMocks.replace).toHaveBeenCalledWith('/');
  });

  it('transitions from the pre-prompt to the camera after the user grants access', async () => {
    setMockCameraPermission('not-determined', 'granted');
    const view = renderWithProvider(<ScanScreen loadModels={STUB_LOAD_MODELS} />);

    await waitFor(() => {
      expect(view.queryByTestId('camera-permission-prompt')).not.toBeNull();
    });

    await act(async () => {
      fireEvent.click(view.getByTestId('camera-permission-primary'));
    });

    await waitFor(() => {
      expect(view.queryByTestId('scan-camera-preview')).not.toBeNull();
    });
    expect(view.queryByTestId('camera-permission-prompt')).toBeNull();
  });

  it('shows scanner error when loadModels rejects', async () => {
    const failLoad: LoadModelsFn = async () => {
      throw new Error('TFLite GPU unavailable');
    };
    setMockCameraPermission('granted');
    const view = renderWithProvider(<ScanScreen loadModels={failLoad} />);

    await waitFor(() => {
      expect(view.queryByTestId('scanner-error')).not.toBeNull();
    });
  });

  it('shows scanner-error retry button', async () => {
    const failLoad: LoadModelsFn = async () => {
      throw new Error('boom');
    };
    setMockCameraPermission('granted');
    const view = renderWithProvider(<ScanScreen loadModels={failLoad} />);

    await waitFor(() => {
      expect(view.queryByTestId('scanner-error-retry')).not.toBeNull();
    });
  });
});
