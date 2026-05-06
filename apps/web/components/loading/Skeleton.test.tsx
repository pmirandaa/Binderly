import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Skeleton } from './Skeleton';
import { renderWithProviders } from '../../test-utils/render';

describe('Skeleton', () => {
  it('renders an aria-hidden placeholder by default', () => {
    renderWithProviders(<Skeleton />);
    const node = screen.getByTestId('skeleton');
    expect(node).toBeInTheDocument();
    expect(node).toHaveAttribute('aria-hidden', 'true');
  });

  it('uses an aria-label when one is supplied', () => {
    renderWithProviders(<Skeleton label="loading row" />);
    const node = screen.getByTestId('skeleton');
    expect(node).toHaveAttribute('aria-label', 'loading row');
    expect(node).not.toHaveAttribute('aria-hidden');
  });
});
