import { describe, expect, it } from 'vitest';

import { Skeleton } from './Skeleton';
import { renderWithProvider } from '../../test-utils/render';

describe('<Skeleton>', () => {
  it('renders without throwing', () => {
    const result = renderWithProvider(<Skeleton />);
    expect(result.container.firstChild).toBeTruthy();
  });

  it('honours the supplied accessibility label', () => {
    const result = renderWithProvider(<Skeleton accessibilityLabel="Loading set list" />);
    // jsdom renders `accessibilityLabel` as `aria-label` via Tamagui's web fork.
    const node = result.container.querySelector('[aria-label="Loading set list"]');
    expect(node).toBeTruthy();
  });

  it('renders multiple instances independently', () => {
    const result = renderWithProvider(
      <>
        <Skeleton width={120} accessibilityLabel="Loading first" />
        <Skeleton width="50%" accessibilityLabel="Loading second" />
        <Skeleton height={48} accessibilityLabel="Loading third" />
      </>,
    );
    const placeholders = result.container.querySelectorAll('[aria-label^="Loading "]');
    expect(placeholders.length).toBe(3);
  });
});
