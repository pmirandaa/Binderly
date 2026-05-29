import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { routerMocks } = vi.hoisted(() => ({
  routerMocks: { push: vi.fn(), replace: vi.fn(), back: vi.fn(), canGoBack: vi.fn(() => true) },
}));

vi.mock('expo-router', () => ({
  useRouter: () => routerMocks,
  router: routerMocks,
}));

const hoisted = vi.hoisted(() => ({
  gateState: { result: { allowed: true }, isLoading: false } as GateState,
}));

vi.mock('./useGate', () => ({
  useGate: () => hoisted.gateState,
  useLimitGate: () => hoisted.gateState,
}));

import { Gate, MOBILE_UPGRADE_ROUTE, UpgradePrompt } from './Gate';
import { renderWithProvider } from '../../test-utils/render';

import type { GateState } from './useGate';

beforeEach(() => {
  routerMocks.push.mockClear();
  hoisted.gateState = { result: { allowed: true }, isLoading: false };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('<Gate>', () => {
  it('renders the skeleton (not the children) while loading', () => {
    hoisted.gateState = {
      result: { allowed: false, reason: 'requires_pro', feature: 'export_data' },
      isLoading: true,
    };
    renderWithProvider(
      <Gate feature="export_data">
        <div data-testid="protected" />
      </Gate>,
    );
    expect(screen.getByTestId('gate-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('protected')).not.toBeInTheDocument();
  });

  it('renders children when allowed', () => {
    hoisted.gateState = { result: { allowed: true }, isLoading: false };
    renderWithProvider(
      <Gate feature="export_data">
        <div data-testid="protected" />
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
    renderWithProvider(
      <Gate feature="pricing_history">
        <div data-testid="protected" />
      </Gate>,
    );
    expect(screen.getByTestId('upgrade-prompt')).toBeInTheDocument();
    expect(screen.queryByTestId('protected')).not.toBeInTheDocument();
  });

  it('honours a custom loadingFallback', () => {
    hoisted.gateState = { result: { allowed: true }, isLoading: true };
    renderWithProvider(
      <Gate feature="export_data" loadingFallback={<div data-testid="custom-load" />}>
        <div data-testid="protected" />
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
    renderWithProvider(
      <Gate feature="export_data" blockedFallback={<div data-testid="custom-block" />}>
        <div data-testid="protected" />
      </Gate>,
    );
    expect(screen.getByTestId('custom-block')).toBeInTheDocument();
    expect(screen.queryByTestId('upgrade-prompt')).not.toBeInTheDocument();
  });
});

describe('<UpgradePrompt>', () => {
  it('renders title + body', () => {
    renderWithProvider(<UpgradePrompt feature="export_data" reason="requires_pro" />);
    expect(screen.getByTestId('upgrade-prompt-title')).toBeInTheDocument();
    expect(screen.getByTestId('upgrade-prompt-body')).toBeInTheDocument();
  });

  it('CTA navigates to the upgrade route by default', () => {
    renderWithProvider(<UpgradePrompt feature="export_data" reason="requires_pro" />);
    fireEvent.click(screen.getByTestId('upgrade-prompt-cta'));
    expect(routerMocks.push).toHaveBeenCalledWith(MOBILE_UPGRADE_ROUTE);
  });

  it('CTA calls a custom onUpgrade override instead of navigating', () => {
    const onUpgrade = vi.fn();
    renderWithProvider(
      <UpgradePrompt feature="export_data" reason="requires_pro" onUpgrade={onUpgrade} />,
    );
    fireEvent.click(screen.getByTestId('upgrade-prompt-cta'));
    expect(onUpgrade).toHaveBeenCalledTimes(1);
    expect(routerMocks.push).not.toHaveBeenCalled();
  });

  it('renders the limit copy for a free_limit_reached gate', () => {
    renderWithProvider(
      <UpgradePrompt feature="unlimited_shareables" reason="free_limit_reached" limit={1} />,
    );
    expect(screen.getByTestId('upgrade-prompt-body')).toHaveTextContent('up to 1');
  });

  it('supports a custom testID', () => {
    renderWithProvider(
      <UpgradePrompt feature="export_data" reason="requires_pro" testID="export-upsell" />,
    );
    expect(screen.getByTestId('export-upsell')).toBeInTheDocument();
  });
});
