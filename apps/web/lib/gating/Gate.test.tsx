import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/collections/custom',
  useSearchParams: () => new URLSearchParams(),
}));

const hoisted = vi.hoisted(() => ({
  gateState: { result: { allowed: true }, isLoading: false } as GateState,
}));

vi.mock('./useGate', () => ({
  useGate: () => hoisted.gateState,
  useLimitGate: () => hoisted.gateState,
}));

import { Gate, UpgradePrompt } from './Gate';
import { renderWithProviders } from '../../test-utils/render';

import type { GateState } from './useGate';

afterEach(() => {
  hoisted.gateState = { result: { allowed: true }, isLoading: false };
});

describe('<Gate>', () => {
  it('renders the skeleton (not the children) while loading', () => {
    hoisted.gateState = { result: { allowed: false, reason: 'requires_pro', feature: 'export_data' }, isLoading: true };
    renderWithProviders(
      <Gate feature="export_data">
        <div data-testid="protected">secret</div>
      </Gate>,
    );
    expect(screen.getByTestId('gate-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('protected')).not.toBeInTheDocument();
    expect(screen.queryByTestId('upgrade-prompt')).not.toBeInTheDocument();
  });

  it('renders children when allowed', () => {
    hoisted.gateState = { result: { allowed: true }, isLoading: false };
    renderWithProviders(
      <Gate feature="export_data">
        <div data-testid="protected">secret</div>
      </Gate>,
    );
    expect(screen.getByTestId('protected')).toBeInTheDocument();
    expect(screen.queryByTestId('upgrade-prompt')).not.toBeInTheDocument();
  });

  it('renders the upgrade prompt when blocked, hiding children', () => {
    hoisted.gateState = {
      result: { allowed: false, reason: 'requires_pro', feature: 'pricing_history' },
      isLoading: false,
    };
    renderWithProviders(
      <Gate feature="pricing_history">
        <div data-testid="protected">secret</div>
      </Gate>,
    );
    expect(screen.getByTestId('upgrade-prompt')).toBeInTheDocument();
    expect(screen.queryByTestId('protected')).not.toBeInTheDocument();
  });

  it('honours a custom loadingFallback', () => {
    hoisted.gateState = { result: { allowed: true }, isLoading: true };
    renderWithProviders(
      <Gate feature="export_data" loadingFallback={<div data-testid="custom-load" />}>
        <div data-testid="protected">secret</div>
      </Gate>,
    );
    expect(screen.getByTestId('custom-load')).toBeInTheDocument();
    expect(screen.queryByTestId('gate-skeleton')).not.toBeInTheDocument();
  });

  it('honours a custom blockedFallback', () => {
    hoisted.gateState = {
      result: { allowed: false, reason: 'requires_pro', feature: 'export_data' },
      isLoading: false,
    };
    renderWithProviders(
      <Gate feature="export_data" blockedFallback={<div data-testid="custom-block" />}>
        <div data-testid="protected">secret</div>
      </Gate>,
    );
    expect(screen.getByTestId('custom-block')).toBeInTheDocument();
    expect(screen.queryByTestId('upgrade-prompt')).not.toBeInTheDocument();
  });
});

describe('<UpgradePrompt>', () => {
  it('renders title, body and a CTA routing to /billing', () => {
    renderWithProviders(<UpgradePrompt feature="export_data" reason="requires_pro" />);
    expect(screen.getByTestId('upgrade-prompt-title')).toHaveTextContent('Upgrade to Pro');
    expect(screen.getByTestId('upgrade-prompt-body')).toBeInTheDocument();
    const cta = screen.getByTestId('upgrade-prompt-cta');
    expect(cta.getAttribute('href')).toBe('/billing');
  });

  it('exposes gate reason + feature as data attributes', () => {
    renderWithProviders(<UpgradePrompt feature="pricing_history" reason="requires_pro" />);
    const node = screen.getByTestId('upgrade-prompt');
    expect(node.getAttribute('data-gate-reason')).toBe('requires_pro');
    expect(node.getAttribute('data-gate-feature')).toBe('pricing_history');
  });

  it('renders the limit copy for a free_limit_reached gate', () => {
    renderWithProviders(
      <UpgradePrompt feature="unlimited_custom_collections" reason="free_limit_reached" limit={3} />,
    );
    expect(screen.getByTestId('upgrade-prompt-body')).toHaveTextContent('up to 3');
  });

  it('supports a custom CTA label', () => {
    renderWithProviders(
      <UpgradePrompt feature="export_data" reason="requires_pro" ctaLabel="Unlock export" />,
    );
    expect(screen.getByTestId('upgrade-prompt-cta')).toHaveTextContent('Unlock export');
  });

  it('supports a custom testId', () => {
    renderWithProviders(
      <UpgradePrompt feature="export_data" reason="requires_pro" testId="export-upsell" />,
    );
    expect(screen.getByTestId('export-upsell')).toBeInTheDocument();
  });
});
