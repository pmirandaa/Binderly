import { describe, expect, it } from 'vitest';

import { SPINNER_SIZE_PX, Spinner } from './spinner.js';
import { renderWithProvider } from '../test-utils/render.js';

describe('<Spinner>', () => {
  it('renders with role="status"', () => {
    const { getByRole } = renderWithProvider(<Spinner />);
    expect(getByRole('status')).toBeInTheDocument();
  });

  it('forwards aria-label', () => {
    const { getByRole } = renderWithProvider(<Spinner aria-label="Loading data" />);
    expect(getByRole('status')).toHaveAttribute('aria-label', 'Loading data');
  });

  it('uses "Loading" as the default a11y label', () => {
    const { getByRole } = renderWithProvider(<Spinner />);
    expect(getByRole('status')).toHaveAttribute('aria-label', 'Loading');
  });

  it.each(['sm', 'md', 'lg'] as const)('renders size "%s" without throwing', (size) => {
    const { getByRole } = renderWithProvider(<Spinner size={size} />);
    expect(getByRole('status')).toBeInTheDocument();
  });

  describe('size monotonicity (lg > md > sm)', () => {
    it('SPINNER_SIZE_PX strictly increases', () => {
      expect(SPINNER_SIZE_PX.lg).toBeGreaterThan(SPINNER_SIZE_PX.md);
      expect(SPINNER_SIZE_PX.md).toBeGreaterThan(SPINNER_SIZE_PX.sm);
    });

    it('exposes a numeric pixel value for every size', () => {
      expect(typeof SPINNER_SIZE_PX.sm).toBe('number');
      expect(typeof SPINNER_SIZE_PX.md).toBe('number');
      expect(typeof SPINNER_SIZE_PX.lg).toBe('number');
    });
  });
});
