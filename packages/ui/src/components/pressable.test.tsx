import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Pressable } from './pressable.js';
import { renderWithProvider } from '../test-utils/render.js';

describe('<Pressable>', () => {
  it('renders children', () => {
    const { getByText } = renderWithProvider(
      <Pressable>
        <span>tap me</span>
      </Pressable>,
    );
    expect(getByText('tap me')).toBeInTheDocument();
  });

  it('fires onPress on click', () => {
    const handler = vi.fn();
    const { getByTestId } = renderWithProvider(
      <Pressable testID="press" onPress={handler}>
        <span>x</span>
      </Pressable>,
    );
    fireEvent.click(getByTestId('press'));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not fire onPress when disabled', () => {
    const handler = vi.fn();
    const { getByTestId } = renderWithProvider(
      <Pressable testID="press" disabled onPress={handler}>
        <span>x</span>
      </Pressable>,
    );
    fireEvent.click(getByTestId('press'));
    expect(handler).not.toHaveBeenCalled();
  });

  it('forwards `aria-label` (web semantics)', () => {
    const { getByLabelText } = renderWithProvider(
      <Pressable aria-label="open menu">
        <span>icon</span>
      </Pressable>,
    );
    expect(getByLabelText('open menu')).toBeInTheDocument();
  });

  it('sets aria-disabled when disabled', () => {
    const { getByTestId } = renderWithProvider(
      <Pressable testID="press" disabled>
        <span>x</span>
      </Pressable>,
    );
    expect(getByTestId('press')).toHaveAttribute('aria-disabled', 'true');
  });

  it('does not set aria-disabled when enabled', () => {
    const { getByTestId } = renderWithProvider(
      <Pressable testID="press">
        <span>x</span>
      </Pressable>,
    );
    expect(getByTestId('press')).not.toHaveAttribute('aria-disabled');
  });

  it('renders the "ghost" variant without throwing', () => {
    const { getByTestId } = renderWithProvider(
      <Pressable testID="press" variant="ghost">
        <span>x</span>
      </Pressable>,
    );
    expect(getByTestId('press')).toBeInTheDocument();
  });

  it('renders the "default" variant without throwing', () => {
    const { getByTestId } = renderWithProvider(
      <Pressable testID="press" variant="default">
        <span>x</span>
      </Pressable>,
    );
    expect(getByTestId('press')).toBeInTheDocument();
  });
});
