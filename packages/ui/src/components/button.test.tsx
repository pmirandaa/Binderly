import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  BUTTON_SIZES,
  BUTTON_SIZE_METRICS,
  BUTTON_VARIANTS,
  Button,
  type ButtonSize,
  type ButtonVariant,
} from './button.js';
import { renderWithProvider } from '../test-utils/render.js';

describe('<Button>', () => {
  it('renders the label', () => {
    const { getByText } = renderWithProvider(<Button label="Save" />);
    expect(getByText('Save')).toBeInTheDocument();
  });

  it('falls back to `children` when no `label` is provided', () => {
    const { getByText } = renderWithProvider(
      <Button>
        <span>Custom child</span>
      </Button>,
    );
    expect(getByText('Custom child')).toBeInTheDocument();
  });

  it('declares the variant inventory', () => {
    expect([...BUTTON_VARIANTS]).toEqual(['primary', 'secondary', 'ghost', 'destructive']);
  });

  it('declares the size inventory', () => {
    expect([...BUTTON_SIZES]).toEqual(['sm', 'md', 'lg']);
  });

  it.each(BUTTON_VARIANTS)('renders variant "%s" without throwing', (variant) => {
    const { getByText } = renderWithProvider(
      <Button label={variant} variant={variant as ButtonVariant} />,
    );
    expect(getByText(variant)).toBeInTheDocument();
  });

  it.each(BUTTON_SIZES)('renders size "%s" without throwing', (size) => {
    const { getByText } = renderWithProvider(<Button label={size} size={size as ButtonSize} />);
    expect(getByText(size)).toBeInTheDocument();
  });

  describe('size monotonicity (lg > md > sm)', () => {
    it('height: lg > md > sm', () => {
      expect(BUTTON_SIZE_METRICS.lg.height).toBeGreaterThan(BUTTON_SIZE_METRICS.md.height);
      expect(BUTTON_SIZE_METRICS.md.height).toBeGreaterThan(BUTTON_SIZE_METRICS.sm.height);
    });

    it('paddingHorizontal: lg >= md >= sm', () => {
      expect(BUTTON_SIZE_METRICS.lg.paddingHorizontal).toBeGreaterThanOrEqual(
        BUTTON_SIZE_METRICS.md.paddingHorizontal,
      );
      expect(BUTTON_SIZE_METRICS.md.paddingHorizontal).toBeGreaterThanOrEqual(
        BUTTON_SIZE_METRICS.sm.paddingHorizontal,
      );
    });

    it('fontSize: lg >= md >= sm', () => {
      expect(BUTTON_SIZE_METRICS.lg.fontSize).toBeGreaterThanOrEqual(
        BUTTON_SIZE_METRICS.md.fontSize,
      );
      expect(BUTTON_SIZE_METRICS.md.fontSize).toBeGreaterThanOrEqual(
        BUTTON_SIZE_METRICS.sm.fontSize,
      );
    });
  });

  describe('press handling', () => {
    it('fires onPress on click when enabled', () => {
      const handler = vi.fn();
      const { getByText } = renderWithProvider(<Button label="Tap" onPress={handler} />);
      fireEvent.click(getByText('Tap'));
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('does NOT fire onPress when disabled', () => {
      const handler = vi.fn();
      const { getByText } = renderWithProvider(<Button label="Tap" onPress={handler} disabled />);
      fireEvent.click(getByText('Tap'));
      expect(handler).not.toHaveBeenCalled();
    });

    it('does NOT fire onPress when loading', () => {
      const handler = vi.fn();
      const { getByRole } = renderWithProvider(<Button label="Tap" onPress={handler} loading />);
      fireEvent.click(getByRole('button'));
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('a11y', () => {
    it('forwards aria-label', () => {
      const { getByLabelText } = renderWithProvider(<Button label="Save" aria-label="save form" />);
      expect(getByLabelText('save form')).toBeInTheDocument();
    });

    it('falls back to `label` for aria-label when no override is given', () => {
      const { getByLabelText } = renderWithProvider(<Button label="Cancel" />);
      expect(getByLabelText('Cancel')).toBeInTheDocument();
    });

    it('sets aria-disabled when disabled', () => {
      const { getByRole } = renderWithProvider(<Button label="Tap" disabled />);
      expect(getByRole('button')).toHaveAttribute('aria-disabled', 'true');
    });

    it('sets aria-busy when loading', () => {
      const { getByRole } = renderWithProvider(<Button label="Tap" loading />);
      expect(getByRole('button')).toHaveAttribute('aria-busy', 'true');
    });
  });

  describe('loading state', () => {
    it('hides the label when loading', () => {
      const { queryByText } = renderWithProvider(<Button label="Tap" loading />);
      expect(queryByText('Tap')).toBeNull();
    });

    it('renders a spinner with role="status"', () => {
      const { getByRole } = renderWithProvider(<Button label="Tap" loading />);
      expect(getByRole('status')).toBeInTheDocument();
    });
  });
});
