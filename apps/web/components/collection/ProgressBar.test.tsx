import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ProgressBar } from './ProgressBar';
import { renderWithProviders } from '../../test-utils/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/collection',
  useSearchParams: () => new URLSearchParams(),
}));

describe('ProgressBar', () => {
  it('renders label + formatted percentage', () => {
    renderWithProviders(<ProgressBar label="Set" value={13.456} testId="b" />);
    expect(screen.getByTestId('b-label')).toHaveTextContent('Set');
    expect(screen.getByTestId('b-value')).toHaveTextContent('13.5%');
  });

  it('appends the optional countLabel after the percentage', () => {
    renderWithProviders(
      <ProgressBar label="Set" value={50} countLabel="6 / 12 owned" testId="b" />,
    );
    expect(screen.getByTestId('b-value')).toHaveTextContent('50.0% · 6 / 12 owned');
  });

  it('exposes aria-valuenow with one-decimal rounding', () => {
    renderWithProviders(<ProgressBar label="Set" value={42.34} testId="b" />);
    const bar = screen.getByTestId('b-track');
    expect(bar.getAttribute('aria-valuenow')).toBe('42.3');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
  });

  it('clamps NaN / negative values to 0 and over-100 to 100', () => {
    renderWithProviders(
      <ProgressBar label="Set" value={Number.NaN} testId="zero" />,
    );
    renderWithProviders(
      <ProgressBar label="Master" value={150} testId="over" />,
    );
    expect(screen.getByTestId('zero-track').getAttribute('aria-valuenow')).toBe('0');
    expect(screen.getByTestId('over-track').getAttribute('aria-valuenow')).toBe('100');
  });
});
