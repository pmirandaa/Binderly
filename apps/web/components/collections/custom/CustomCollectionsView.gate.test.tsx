// Gate-presence regression tests for the custom-collections create gate
// (T-PB-GATING). The base suite (`CustomCollectionsView.test.tsx`)
// exercises the free path via the real `useLimitGate` (signed-out →
// free); this file mocks the gate to assert the Pro-unlimited path and
// the free-at-cap block independently of the entitlement read.

import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CustomCollectionsView } from './CustomCollectionsView';
import { createFakeCustomCollectionApi, makeCustomCollection } from '../../../lib/collections/custom/fixtures';
import { renderWithProviders } from '../../../test-utils/render';

import type { GateState } from '../../../lib/gating';

const hoisted = vi.hoisted(() => ({
  gateState: { result: { allowed: true }, isLoading: false } as GateState,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/collections/custom',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('../../../lib/gating', () => ({
  useLimitGate: () => hoisted.gateState,
}));

function fourManual() {
  return [
    makeCustomCollection({ id: 'cc-1', name: 'A' }),
    makeCustomCollection({ id: 'cc-2', name: 'B' }),
    makeCustomCollection({ id: 'cc-3', name: 'C' }),
    makeCustomCollection({ id: 'cc-4', name: 'D' }),
  ];
}

describe('CustomCollectionsView — entitlement-aware create gate', () => {
  it('pro user past the free cap can still create (button enabled, no upsell)', async () => {
    hoisted.gateState = { result: { allowed: true }, isLoading: false };
    const api = createFakeCustomCollectionApi({ collections: fourManual() });
    renderWithProviders(<CustomCollectionsView api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('custom-collections-list')).toBeInTheDocument();
    });
    const btn = screen.getByTestId('custom-collections-new-button');
    expect(btn.getAttribute('aria-disabled')).not.toBe('true');
    expect(screen.queryByTestId('custom-collections-upgrade-link')).not.toBeInTheDocument();
  });

  it('free user at the cap is blocked (button disabled + upsell link to /billing)', async () => {
    hoisted.gateState = {
      result: { allowed: false, reason: 'free_limit_reached', feature: 'unlimited_custom_collections', limit: 3 },
      isLoading: false,
    };
    const api = createFakeCustomCollectionApi({
      collections: [
        makeCustomCollection({ id: 'cc-1', name: 'A' }),
        makeCustomCollection({ id: 'cc-2', name: 'B' }),
        makeCustomCollection({ id: 'cc-3', name: 'C' }),
      ],
    });
    renderWithProviders(<CustomCollectionsView api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('custom-collections-list')).toBeInTheDocument();
    });
    expect(screen.getByTestId('custom-collections-new-button').getAttribute('aria-disabled')).toBe(
      'true',
    );
    expect(screen.getByTestId('custom-collections-upgrade-link').getAttribute('href')).toBe(
      '/billing',
    );
  });
});
