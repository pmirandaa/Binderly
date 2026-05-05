import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { INPUT_SIZES, INPUT_SIZE_METRICS, Input, type InputSize } from './input.js';
import { renderWithProvider } from '../test-utils/render.js';

describe('<Input>', () => {
  it('renders without throwing', () => {
    const { container } = renderWithProvider(<Input aria-label="email" />);
    const input = container.querySelector('input');
    expect(input).not.toBeNull();
  });

  it('declares the size inventory', () => {
    expect([...INPUT_SIZES]).toEqual(['sm', 'md', 'lg']);
  });

  it.each(INPUT_SIZES)('renders size "%s"', (size) => {
    const { container } = renderWithProvider(<Input aria-label={size} size={size as InputSize} />);
    expect(container.querySelector('input')).not.toBeNull();
  });

  describe('size monotonicity (lg > md > sm)', () => {
    it('height: lg > md > sm', () => {
      expect(INPUT_SIZE_METRICS.lg.height).toBeGreaterThan(INPUT_SIZE_METRICS.md.height);
      expect(INPUT_SIZE_METRICS.md.height).toBeGreaterThan(INPUT_SIZE_METRICS.sm.height);
    });

    it('paddingHorizontal: lg >= md >= sm', () => {
      expect(INPUT_SIZE_METRICS.lg.paddingHorizontal).toBeGreaterThanOrEqual(
        INPUT_SIZE_METRICS.md.paddingHorizontal,
      );
      expect(INPUT_SIZE_METRICS.md.paddingHorizontal).toBeGreaterThanOrEqual(
        INPUT_SIZE_METRICS.sm.paddingHorizontal,
      );
    });
  });

  describe('change handling', () => {
    it('calls onChangeText with the new string value', () => {
      const handler = vi.fn();
      const { container } = renderWithProvider(<Input aria-label="email" onChangeText={handler} />);
      const input = container.querySelector('input');
      expect(input).not.toBeNull();
      fireEvent.change(input!, { target: { value: 'new value' } });
      expect(handler).toHaveBeenCalledWith('new value');
    });

    it('does NOT call onChangeText when disabled', () => {
      const handler = vi.fn();
      const { container } = renderWithProvider(
        <Input aria-label="email" onChangeText={handler} disabled />,
      );
      const input = container.querySelector('input');
      expect(input).not.toBeNull();
      fireEvent.change(input!, { target: { value: 'attempted' } });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('a11y', () => {
    it('forwards aria-label', () => {
      const { getByLabelText } = renderWithProvider(<Input aria-label="email address" />);
      expect(getByLabelText('email address')).toBeInTheDocument();
    });

    it('sets aria-disabled when disabled', () => {
      const { container } = renderWithProvider(<Input aria-label="email" disabled />);
      const input = container.querySelector('input');
      expect(input).not.toBeNull();
      expect(input).toHaveAttribute('aria-disabled', 'true');
    });

    it('sets aria-invalid when error is true', () => {
      const { container } = renderWithProvider(
        <Input aria-label="email" error errorText="Required" />,
      );
      const input = container.querySelector('input');
      expect(input).not.toBeNull();
      expect(input).toHaveAttribute('aria-invalid', 'true');
    });
  });

  describe('slots', () => {
    it('renders the label slot above the input', () => {
      const { getByText } = renderWithProvider(<Input aria-label="email" label="Email address" />);
      expect(getByText('Email address')).toBeInTheDocument();
    });

    it('renders helperText below the input when no error is shown', () => {
      const { getByText } = renderWithProvider(
        <Input aria-label="email" helperText="We never share your email." />,
      );
      expect(getByText('We never share your email.')).toBeInTheDocument();
    });

    it('replaces helperText with errorText when error is true', () => {
      const { getByText, queryByText } = renderWithProvider(
        <Input
          aria-label="email"
          helperText="We never share your email."
          error
          errorText="Required"
        />,
      );
      expect(getByText('Required')).toBeInTheDocument();
      expect(queryByText('We never share your email.')).toBeNull();
    });

    it('still renders helperText when error is true but errorText is missing', () => {
      const { getByText } = renderWithProvider(
        <Input aria-label="email" helperText="optional helper" error />,
      );
      expect(getByText('optional helper')).toBeInTheDocument();
    });
  });
});
