import { describe, expect, it } from 'vitest';

import { ICON_SIZES, ICON_SIZE_PX, Icon, type IconRendererProps } from './icon.js';
import { renderWithProvider } from '../test-utils/render.js';

import type { ComponentType } from 'react';

const TestStar: ComponentType<IconRendererProps> = ({ size, color, strokeWidth }) => (
  <svg
    data-testid="icon-svg"
    data-size={size}
    data-color={color}
    data-stroke={strokeWidth}
    width={size}
    height={size}
  />
);

describe('<Icon>', () => {
  it('renders the passed icon component via the `as` prop', () => {
    const { getByTestId } = renderWithProvider(<Icon as={TestStar} aria-label="star" />);
    expect(getByTestId('icon-svg')).toBeInTheDocument();
  });

  it('declares the documented size inventory', () => {
    expect([...ICON_SIZES]).toEqual(['xs', 'sm', 'md', 'lg', 'xl']);
  });

  it.each(ICON_SIZES)('renders size "%s" with the matching pixel value', (size) => {
    const { getByTestId } = renderWithProvider(
      <Icon as={TestStar} size={size} aria-label={`size-${size}`} />,
    );
    const svg = getByTestId('icon-svg');
    expect(svg.getAttribute('data-size')).toBe(String(ICON_SIZE_PX[size]));
  });

  it('forwards `color` to the icon renderer', () => {
    const { getByTestId } = renderWithProvider(
      <Icon as={TestStar} color="#ff0000" aria-label="red star" />,
    );
    expect(getByTestId('icon-svg').getAttribute('data-color')).toBe('#ff0000');
  });

  it('forwards `strokeWidth` to the icon renderer', () => {
    const { getByTestId } = renderWithProvider(
      <Icon as={TestStar} strokeWidth={3} aria-label="bold star" />,
    );
    expect(getByTestId('icon-svg').getAttribute('data-stroke')).toBe('3');
  });

  it('honors `children` over the `as` prop', () => {
    const { getByTestId, queryByTestId } = renderWithProvider(
      <Icon as={TestStar} aria-label="custom">
        <span data-testid="custom-child">child</span>
      </Icon>,
    );
    expect(getByTestId('custom-child')).toBeInTheDocument();
    expect(queryByTestId('icon-svg')).toBeNull();
  });

  describe('a11y', () => {
    it('renders role="img" with aria-label by default', () => {
      const { getByRole } = renderWithProvider(<Icon as={TestStar} aria-label="star" />);
      const node = getByRole('img');
      expect(node).toHaveAttribute('aria-label', 'star');
    });

    it('renders role="presentation" + aria-hidden when "decorative"', () => {
      const { container } = renderWithProvider(<Icon as={TestStar} aria-label="decorative" />);
      const node = container.querySelector('[role="presentation"]');
      expect(node).not.toBeNull();
      expect(node).toHaveAttribute('aria-hidden', 'true');
      expect(node).not.toHaveAttribute('aria-label');
    });
  });

  describe('size monotonicity', () => {
    it('xs < sm < md < lg < xl', () => {
      expect(ICON_SIZE_PX.xs).toBeLessThan(ICON_SIZE_PX.sm);
      expect(ICON_SIZE_PX.sm).toBeLessThan(ICON_SIZE_PX.md);
      expect(ICON_SIZE_PX.md).toBeLessThan(ICON_SIZE_PX.lg);
      expect(ICON_SIZE_PX.lg).toBeLessThan(ICON_SIZE_PX.xl);
    });
  });
});
