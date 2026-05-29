// FU-57 — free single-card-scan mode + Pro stack-scanner gate.
//
// Verifies the two-mode behaviour:
//   - free → single-card mode only; the stack/continuous toggle is gated
//     behind `<UpgradePrompt>`, and a match goes to an explicit confirm
//     (no auto-add loop, no session footer, no stack-review).
//   - pro  → both modes; default continuous (auto-add + session footer),
//     switchable to single.
//
// Mocks mirror `./ScanScreen.test.tsx` (ProtectedScreen / api-client /
// useScanner / expo-router) plus a controllable RevenueCat entitlement
// snapshot that the `useGate('stack_scanner')` hook reads through
// `apps/mobile/src/billing`.

import { act, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMatchSink, createMatchQueue } from '../../../scanner/match/index.js';
import { renderWithProvider } from '../../../test-utils/render.js';
import { setMockCameraPermission } from '../../../test-utils/setup.js';
import { ScanScreen } from '../ScanScreen.js';

import type { MatchResult } from '../../../scanner/match/index.js';
import type { LoadModelsFn } from '../use-model-loader.js';

// ============================================================
// Entitlement snapshot (RevenueCat) — drives `useGate`
// ============================================================

const hoisted = vi.hoisted(() => ({
  snapshot: { data: { tier: 'free' } as { tier: 'free' | 'pro' }, isPending: false },
}));

function setTier(tier: 'free' | 'pro'): void {
  hoisted.snapshot = { data: { tier }, isPending: false };
}

vi.mock('../../../billing/index.js', () => ({
  useEntitlementsQuery: () => hoisted.snapshot,
}));

// ============================================================
// Auth + api-client + scanner + router mocks
// ============================================================

vi.mock('../../../lib/auth/index.js', () => ({
  ProtectedScreen: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DEFAULT_SIGN_IN_ROUTE: '/auth/sign-in',
  useRequireAuth: vi.fn(() => ({ loading: false, authenticated: true })),
}));

const mockAddCollectionItem = vi.fn(async (input: { printingId: string }) => ({
  id: `cid-${input.printingId}`,
  printingId: input.printingId,
  quantity: 1,
  source: 'scan',
}));
const mockDeleteCollectionItem = vi.fn(async () => undefined);
const mockGetPrinting = vi.fn(async () => {
  // Single-card confirm / overlay degrade to the printingId placeholder
  // when the catalog lookup fails — exercise that path here.
  throw new Error('no catalog in test');
});

vi.mock('../../../lib/api-client.js', () => ({
  useApiClient: vi.fn(() => ({
    collection: {
      addCollectionItem: mockAddCollectionItem,
      deleteCollectionItem: mockDeleteCollectionItem,
    },
    cards: { getPrinting: mockGetPrinting },
  })),
  ApiClientProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

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

const { routerMocks } = vi.hoisted(() => ({
  routerMocks: { push: vi.fn(), replace: vi.fn(), back: vi.fn(), canGoBack: vi.fn(() => true) },
}));

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
  router: routerMocks,
  useRouter: () => routerMocks,
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

function autoAddMatch(printingId = 'sv1-001'): MatchResult {
  return {
    printingId,
    confidence: 0.95,
    topGap: 0.4,
    disposition: 'auto-add',
    candidates: [{ printingId, score: 0.95, distance: 0.05 }],
    stabilityCount: 3,
    framesSinceMatch: 0,
    emittedAtMs: 1,
  };
}

async function renderGranted() {
  setMockCameraPermission('granted');
  const view = renderWithProvider(<ScanScreen loadModels={STUB_LOAD_MODELS} />);
  await waitFor(() => {
    expect(view.queryByTestId('scan-camera-preview')).not.toBeNull();
  });
  return view;
}

beforeEach(() => {
  routerMocks.push.mockClear();
  mockSink.clear();
  mockQueue.clear();
  mockAddCollectionItem.mockClear();
  mockDeleteCollectionItem.mockClear();
  setTier('free');
});

// ============================================================
// Free tier — single-card only, stack gated
// ============================================================

describe('<ScanScreen> — free tier (single-card scan)', () => {
  it('shows the mode toggle with the stack segment marked Pro', async () => {
    const view = await renderGranted();
    expect(view.queryByTestId('scan-mode-toggle')).not.toBeNull();
    // Free → stack segment carries the "Pro" affordance in its label.
    expect(view.getByTestId('scan-mode-toggle-stack').textContent).toContain('Pro');
  });

  it('tapping the stack toggle shows the upgrade prompt instead of switching', async () => {
    const view = await renderGranted();
    expect(view.queryByTestId('stack-scanner-upsell')).toBeNull();

    fireEvent.click(view.getByTestId('scan-mode-toggle-stack'));

    await waitFor(() => {
      expect(view.queryByTestId('stack-scanner-upsell')).not.toBeNull();
    });
    // Still no continuous-mode session footer — the mode did not switch.
    expect(view.queryByTestId('session-footer')).toBeNull();
  });

  it('a match goes to single-card confirm (no auto-add overlay / footer)', async () => {
    const view = await renderGranted();

    act(() => {
      mockSink.emit(autoAddMatch());
    });

    await waitFor(() => {
      expect(view.queryByTestId('single-card-confirm')).not.toBeNull();
    });
    // No continuous auto-add: nothing added yet, no session footer.
    expect(mockAddCollectionItem).not.toHaveBeenCalled();
    expect(view.queryByTestId('session-footer')).toBeNull();
    expect(view.queryByTestId('match-overlay')).toBeNull();
  });

  it('confirming adds exactly one card and shows the success card', async () => {
    const view = await renderGranted();

    act(() => {
      mockSink.emit(autoAddMatch('sv1-042'));
    });
    await waitFor(() => {
      expect(view.queryByTestId('single-card-confirm')).not.toBeNull();
    });

    await act(async () => {
      fireEvent.click(view.getByTestId('single-card-confirm-add'));
    });

    await waitFor(() => {
      expect(view.queryByTestId('single-card-success')).not.toBeNull();
    });
    expect(mockAddCollectionItem).toHaveBeenCalledTimes(1);
    expect(mockAddCollectionItem).toHaveBeenCalledWith({
      printingId: 'sv1-042',
      source: 'scan',
    });
    // Never enters stack-review (no StackPanel).
    expect(view.queryByTestId('stack-panel')).toBeNull();
  });
});

// ============================================================
// Pro tier — both modes
// ============================================================

describe('<ScanScreen> — pro tier (stack + single)', () => {
  beforeEach(() => {
    setTier('pro');
  });

  it('shows the mode toggle without the Pro lock', async () => {
    const view = await renderGranted();
    expect(view.queryByTestId('scan-mode-toggle')).not.toBeNull();
    expect(view.getByTestId('scan-mode-toggle-stack').textContent).not.toContain('Pro');
  });

  it('defaults to continuous: a match auto-adds and the session footer appears', async () => {
    const view = await renderGranted();

    await act(async () => {
      mockSink.emit(autoAddMatch());
    });

    await waitFor(() => {
      expect(view.queryByTestId('session-footer')).not.toBeNull();
    });
    expect(mockAddCollectionItem).toHaveBeenCalledTimes(1);
    // Continuous mode → no single-card confirm.
    expect(view.queryByTestId('single-card-confirm')).toBeNull();
  });

  it('can switch to single mode; then a match goes to confirm (no footer)', async () => {
    const view = await renderGranted();

    fireEvent.click(view.getByTestId('scan-mode-toggle-single'));

    act(() => {
      mockSink.emit(autoAddMatch());
    });

    await waitFor(() => {
      expect(view.queryByTestId('single-card-confirm')).not.toBeNull();
    });
    expect(view.queryByTestId('session-footer')).toBeNull();
    expect(mockAddCollectionItem).not.toHaveBeenCalled();
  });
});
