import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BillingRoute } from './BillingRoute';
import { renderWithProviders } from '../../test-utils/render';
import { createFakeSupabase } from '../../test-utils/supabase-stub';

import type { EntitlementSnapshot } from '../../lib/paddle/entitlements';
import type { PublicPaddleEnvResult } from '../../lib/paddle/env';
import type { Session } from '@supabase/supabase-js';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/billing',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('../../lib/api-client', () => ({
  getApiClient: () => ({}),
}));

function fakeSession(): Session {
  return {
    access_token: 'tok',
    refresh_token: 'rt',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: 'user-1',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: '2024-01-01T00:00:00.000Z',
      email: 'test@example.com',
    },
  } as Session;
}

const CONFIGURED_ENV: PublicPaddleEnvResult = {
  kind: 'configured',
  clientToken: 'pdl_test',
  environment: 'sandbox',
  priceMonthly: 'pri_monthly',
  priceAnnual: 'pri_annual',
};

const UNCONFIGURED_ENV: PublicPaddleEnvResult = {
  kind: 'unconfigured',
  missing: ['NEXT_PUBLIC_PADDLE_CLIENT_TOKEN'],
};

const FREE: EntitlementSnapshot = {
  tier: 'free',
  source: null,
  externalCustomerId: null,
  expiresAt: null,
  authoritative: true,
};

describe('BillingRoute — auth gating', () => {
  it('renders a sign-in prompt when no user is signed in', async () => {
    const fake = createFakeSupabase(null);
    renderWithProviders(
      <BillingRoute env={CONFIGURED_ENV} entitlement={FREE} />,
      { supabase: fake.client },
    );
    await waitFor(() => {
      expect(screen.getByTestId('collection-sign-in-prompt')).toBeInTheDocument();
    });
    expect(
      screen.getByTestId('collection-sign-in-link').getAttribute('href'),
    ).toContain('next=%2Fbilling');
  });

  it('renders the BillingView when a session is present', async () => {
    const fake = createFakeSupabase(fakeSession());
    renderWithProviders(
      <BillingRoute env={CONFIGURED_ENV} entitlement={FREE} />,
      { supabase: fake.client },
    );
    await waitFor(() => {
      expect(screen.getByTestId('billing-page')).toBeInTheDocument();
    });
  });
});

describe('BillingRoute — env gating', () => {
  it('renders the unconfigured placeholder when env is unconfigured', async () => {
    const fake = createFakeSupabase(fakeSession());
    renderWithProviders(
      <BillingRoute env={UNCONFIGURED_ENV} entitlement={FREE} />,
      { supabase: fake.client },
    );
    await waitFor(() => {
      expect(screen.getByTestId('billing-unconfigured')).toBeInTheDocument();
    });
  });
});

describe('BillingRoute — entitlement seed', () => {
  it('renders the seeded entitlement (free) without hitting the api-client', async () => {
    const fake = createFakeSupabase(fakeSession());
    renderWithProviders(
      <BillingRoute env={CONFIGURED_ENV} entitlement={FREE} />,
      { supabase: fake.client },
    );
    await waitFor(() => {
      expect(screen.getByTestId('billing-current-tier-label')).toHaveTextContent('Free');
    });
  });

  it('renders the seeded entitlement (pro)', async () => {
    const fake = createFakeSupabase(fakeSession());
    renderWithProviders(
      <BillingRoute
        env={CONFIGURED_ENV}
        entitlement={{
          tier: 'pro',
          source: 'paddle',
          externalCustomerId: 'cus_x',
          expiresAt: null,
          authoritative: true,
        }}
      />,
      { supabase: fake.client },
    );
    await waitFor(() => {
      expect(screen.getByTestId('billing-current-tier-label')).toHaveTextContent('Pro');
    });
  });
});
