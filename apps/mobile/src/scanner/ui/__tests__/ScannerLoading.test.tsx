import React from 'react';
import { describe, expect, it } from 'vitest';

import { renderWithProvider } from '../../../test-utils/render.js';
import { ScannerLoading } from '../ScannerLoading.js';

describe('<ScannerLoading>', () => {
  it('renders the loading screen', () => {
    const view = renderWithProvider(<ScannerLoading />);
    expect(view.queryByTestId('scanner-loading')).not.toBeNull();
  });

  it('renders the spinner', () => {
    const view = renderWithProvider(<ScannerLoading />);
    expect(view.queryByTestId('scanner-loading-spinner')).not.toBeNull();
  });

  it('renders a title', () => {
    const view = renderWithProvider(<ScannerLoading />);
    expect(view.queryByTestId('scanner-loading-title')).not.toBeNull();
    expect(view.container.textContent).toContain('Preparing scanner');
  });

  it('renders a subtitle', () => {
    const view = renderWithProvider(<ScannerLoading />);
    expect(view.queryByTestId('scanner-loading-subtitle')).not.toBeNull();
  });

  it('accepts custom testID', () => {
    const view = renderWithProvider(<ScannerLoading testID="my-loading" />);
    expect(view.queryByTestId('my-loading')).not.toBeNull();
  });
});
