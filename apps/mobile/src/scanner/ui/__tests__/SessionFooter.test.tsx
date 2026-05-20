import { fireEvent } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProvider } from '../../../test-utils/render.js';
import { SessionFooter } from '../SessionFooter.js';

describe('<SessionFooter>', () => {
  it('renders nothing when itemCount is 0', () => {
    const view = renderWithProvider(
      <SessionFooter itemCount={0} onDone={vi.fn()} />,
    );
    expect(view.queryByTestId('session-footer')).toBeNull();
  });

  it('renders the footer when itemCount > 0', () => {
    const view = renderWithProvider(
      <SessionFooter itemCount={3} onDone={vi.fn()} />,
    );
    expect(view.queryByTestId('session-footer')).not.toBeNull();
  });

  it('shows singular "1 card added"', () => {
    const view = renderWithProvider(
      <SessionFooter itemCount={1} onDone={vi.fn()} />,
    );
    expect(view.container.textContent).toContain('1 card added');
  });

  it('shows plural "N cards added" for count > 1', () => {
    const view = renderWithProvider(
      <SessionFooter itemCount={5} onDone={vi.fn()} />,
    );
    expect(view.container.textContent).toContain('5 cards added');
  });

  it('calls onDone when Done button is clicked', () => {
    const onDone = vi.fn();
    const view = renderWithProvider(
      <SessionFooter itemCount={2} onDone={onDone} />,
    );
    fireEvent.click(view.getByTestId('session-footer-done'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('accepts custom testID', () => {
    const view = renderWithProvider(
      <SessionFooter itemCount={1} onDone={vi.fn()} testID="my-footer" />,
    );
    expect(view.queryByTestId('my-footer')).not.toBeNull();
  });
});
