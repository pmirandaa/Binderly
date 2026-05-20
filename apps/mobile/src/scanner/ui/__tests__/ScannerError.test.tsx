import { fireEvent } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProvider } from '../../../test-utils/render.js';
import { ScannerError } from '../ScannerError.js';

describe('<ScannerError>', () => {
  it('renders the error screen', () => {
    const view = renderWithProvider(<ScannerError error={null} onRetry={vi.fn()} />);
    expect(view.queryByTestId('scanner-error')).not.toBeNull();
  });

  it('renders a title', () => {
    const view = renderWithProvider(<ScannerError error={null} onRetry={vi.fn()} />);
    expect(view.queryByTestId('scanner-error-title')).not.toBeNull();
    expect(view.container.textContent).toContain('Scanner unavailable');
  });

  it('renders the error message when error is provided', () => {
    const error = new Error('TFLite failed to load GPU delegate');
    const view = renderWithProvider(<ScannerError error={error} onRetry={vi.fn()} />);
    expect(view.container.textContent).toContain('TFLite failed to load GPU delegate');
  });

  it('renders a fallback message when error is null', () => {
    const view = renderWithProvider(<ScannerError error={null} onRetry={vi.fn()} />);
    expect(view.container.textContent).toContain('failed to load');
  });

  it('calls onRetry when the retry button is clicked', () => {
    const onRetry = vi.fn();
    const view = renderWithProvider(<ScannerError error={null} onRetry={onRetry} />);
    fireEvent.click(view.getByTestId('scanner-error-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('accepts custom testID', () => {
    const view = renderWithProvider(
      <ScannerError error={null} onRetry={vi.fn()} testID="my-error" />,
    );
    expect(view.queryByTestId('my-error')).not.toBeNull();
  });

  it('shows all sub-testIDs', () => {
    const view = renderWithProvider(<ScannerError error={null} onRetry={vi.fn()} />);
    expect(view.queryByTestId('scanner-error-title')).not.toBeNull();
    expect(view.queryByTestId('scanner-error-message')).not.toBeNull();
    expect(view.queryByTestId('scanner-error-retry')).not.toBeNull();
  });
});
