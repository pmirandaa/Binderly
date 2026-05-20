import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BillingView, type BillingApi } from './BillingView';
import { renderWithProviders } from '../../test-utils/render';

import type { EntitlementSnapshot } from '../../lib/paddle/entitlements';
import type { PaddlePriceIds } from '../../lib/paddle/plans';


vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/billing',
  useSearchParams: () => new URLSearchParams(),
}));

const FREE: EntitlementSnapshot = {
  tier: 'free',
  source: null,
  externalCustomerId: null,
  expiresAt: null,
  authoritative: true,
};

const PRO: EntitlementSnapshot = {
  tier: 'pro',
  source: 'paddle',
  externalCustomerId: 'cus_abc',
  expiresAt: '2027-01-01T00:00:00.000Z',
  authoritative: true,
};

const PRICES: PaddlePriceIds = { monthly: 'pri_monthly', annual: 'pri_annual' };

function makeApi(overrides: Partial<BillingApi> = {}): BillingApi {
  return {
    openCheckout: vi.fn().mockResolvedValue(undefined),
    openCustomerPortal: vi.fn(),
    ...overrides,
  };
}

describe('BillingView — unconfigured env', () => {
  it('renders the placeholder when clientTokenConfigured is false', () => {
    renderWithProviders(
      <BillingView
        api={makeApi()}
        entitlement={FREE}
        priceIds={PRICES}
        clientTokenConfigured={false}
      />,
    );
    expect(screen.getByTestId('billing-unconfigured')).toBeInTheDocument();
    expect(screen.queryByTestId('billing-plan-list')).not.toBeInTheDocument();
  });

  it('does not call openCheckout when in unconfigured state', () => {
    const api = makeApi();
    renderWithProviders(
      <BillingView
        api={api}
        entitlement={FREE}
        priceIds={PRICES}
        clientTokenConfigured={false}
      />,
    );
    expect(api.openCheckout).not.toHaveBeenCalled();
  });
});

describe('BillingView — free tier', () => {
  it('renders the current-tier card with "Free"', () => {
    renderWithProviders(
      <BillingView
        api={makeApi()}
        entitlement={FREE}
        priceIds={PRICES}
        clientTokenConfigured
      />,
    );
    expect(screen.getByTestId('billing-current-tier-label')).toHaveTextContent('Free');
  });

  it('renders the plan list with one card per plan', () => {
    renderWithProviders(
      <BillingView
        api={makeApi()}
        entitlement={FREE}
        priceIds={PRICES}
        clientTokenConfigured
      />,
    );
    const cards = screen.getAllByTestId('billing-plan-card');
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.getAttribute('data-plan-id'))).toEqual([
      'pro_monthly',
      'pro_annual',
    ]);
  });

  it('opens the checkout overlay with the correct price id and plan id when subscribing monthly', () => {
    const api = makeApi();
    renderWithProviders(
      <BillingView
        api={api}
        entitlement={FREE}
        priceIds={PRICES}
        clientTokenConfigured
      />,
    );
    const button = screen.getByLabelText('Subscribe to Pro — Monthly');
    fireEvent.click(button);
    expect(api.openCheckout).toHaveBeenCalledTimes(1);
    expect(api.openCheckout).toHaveBeenCalledWith({
      priceId: 'pri_monthly',
      planId: 'pro_monthly',
    });
  });

  it('opens the checkout overlay with the annual price id', () => {
    const api = makeApi();
    renderWithProviders(
      <BillingView
        api={api}
        entitlement={FREE}
        priceIds={PRICES}
        clientTokenConfigured
      />,
    );
    fireEvent.click(screen.getByLabelText('Subscribe to Pro — Annual'));
    expect(api.openCheckout).toHaveBeenCalledWith({
      priceId: 'pri_annual',
      planId: 'pro_annual',
    });
  });

  it('disables the button + shows the missing-price hint when its env price is null', () => {
    renderWithProviders(
      <BillingView
        api={makeApi()}
        entitlement={FREE}
        priceIds={{ monthly: null, annual: 'pri_annual' }}
        clientTokenConfigured
      />,
    );
    expect(screen.getByTestId('billing-plan-pro_monthly-missing-price')).toBeInTheDocument();
    expect(screen.queryByTestId('billing-plan-pro_annual-missing-price')).not.toBeInTheDocument();
  });

  it('renders an error card when the checkout adapter throws', async () => {
    const api = makeApi({
      openCheckout: vi.fn().mockRejectedValue(new Error('SDK blocked')),
    });
    renderWithProviders(
      <BillingView
        api={api}
        entitlement={FREE}
        priceIds={PRICES}
        clientTokenConfigured
      />,
    );
    fireEvent.click(screen.getByLabelText('Subscribe to Pro — Monthly'));
    await screen.findByTestId('billing-error');
    expect(screen.getByTestId('billing-error')).toHaveTextContent('SDK blocked');
  });
});

describe('BillingView — pro tier', () => {
  it('renders the current-tier card with "Pro" + an expiry date', () => {
    renderWithProviders(
      <BillingView
        api={makeApi()}
        entitlement={PRO}
        priceIds={PRICES}
        clientTokenConfigured
      />,
    );
    expect(screen.getByTestId('billing-current-tier-label')).toHaveTextContent('Pro');
    const tier = screen.getByTestId('billing-current-tier');
    expect(tier).toHaveAttribute('data-tier', 'pro');
  });

  it('hides the plan list for pro users', () => {
    renderWithProviders(
      <BillingView
        api={makeApi()}
        entitlement={PRO}
        priceIds={PRICES}
        clientTokenConfigured
      />,
    );
    expect(screen.queryByTestId('billing-plan-list')).not.toBeInTheDocument();
  });

  it('clicking the manage button calls openCustomerPortal', () => {
    const api = makeApi();
    renderWithProviders(
      <BillingView
        api={api}
        entitlement={PRO}
        priceIds={PRICES}
        clientTokenConfigured
      />,
    );
    fireEvent.click(screen.getByLabelText('Manage billing in Paddle'));
    expect(api.openCustomerPortal).toHaveBeenCalledTimes(1);
  });
});

describe('BillingView — degraded entitlement read', () => {
  it('shows the "(Entitlement endpoint not yet deployed)" hint when authoritative=false', () => {
    renderWithProviders(
      <BillingView
        api={makeApi()}
        entitlement={{ ...FREE, authoritative: false }}
        priceIds={PRICES}
        clientTokenConfigured
      />,
    );
    expect(screen.getByTestId('billing-tier-degraded')).toBeInTheDocument();
  });

  it('hides the degraded hint when authoritative=true', () => {
    renderWithProviders(
      <BillingView
        api={makeApi()}
        entitlement={FREE}
        priceIds={PRICES}
        clientTokenConfigured
      />,
    );
    expect(screen.queryByTestId('billing-tier-degraded')).not.toBeInTheDocument();
  });
});
