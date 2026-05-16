import { describe, expect, it } from 'vitest';

import { ProgressBar } from './ProgressBar';
import { renderWithProvider } from '../../test-utils/render';

describe('<ProgressBar>', () => {
  it('renders the progressbar role with the supplied aria-valuenow', () => {
    const result = renderWithProvider(
      <ProgressBar value={42} testID="bar" accessibilityLabel="Set progress" />,
    );
    const bar = result.getByTestId('bar');
    expect(bar.getAttribute('role')).toBe('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('42');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
  });

  it('clamps below-range values to 0', () => {
    const result = renderWithProvider(<ProgressBar value={-12} testID="bar" />);
    expect(result.getByTestId('bar').getAttribute('aria-valuenow')).toBe('0');
  });

  it('clamps above-range values to 100', () => {
    const result = renderWithProvider(<ProgressBar value={120} testID="bar" />);
    expect(result.getByTestId('bar').getAttribute('aria-valuenow')).toBe('100');
  });

  it('renders the fill element with the matching testID suffix', () => {
    const result = renderWithProvider(<ProgressBar value={25} testID="bar" />);
    expect(result.queryByTestId('bar-fill')).not.toBeNull();
  });
});
