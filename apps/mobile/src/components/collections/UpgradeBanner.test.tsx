import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { UpgradeBanner } from './UpgradeBanner';
import { renderWithProvider } from '../../test-utils/render';

describe('<UpgradeBanner>', () => {
  it('renders the default title and description', () => {
    const result = renderWithProvider(<UpgradeBanner />);
    expect(result.container.textContent).toContain('Upgrade to save smart collections');
    expect(result.container.textContent).toContain('Pro plan');
  });

  it('renders custom copy when provided', () => {
    const result = renderWithProvider(
      <UpgradeBanner title="Custom title" description="Custom desc" />,
    );
    expect(result.container.textContent).toContain('Custom title');
    expect(result.container.textContent).toContain('Custom desc');
  });

  it('forwards onUpgrade through the CTA', () => {
    const onUpgrade = vi.fn();
    const result = renderWithProvider(<UpgradeBanner onUpgrade={onUpgrade} />);
    fireEvent.click(result.getByTestId('collections-upgrade-banner-cta'));
    expect(onUpgrade).toHaveBeenCalledTimes(1);
  });

  it('honours a custom testID', () => {
    const result = renderWithProvider(<UpgradeBanner testID="my-banner" />);
    expect(result.getByTestId('my-banner')).toBeDefined();
    expect(result.getByTestId('my-banner-cta')).toBeDefined();
  });
});
