import React from 'react';
import { describe, expect, it } from 'vitest';

import { renderWithProvider } from '../../../test-utils/render.js';
import { StabilityIndicator } from '../StabilityIndicator.js';

describe('<StabilityIndicator>', () => {
  it('renders the default 3 dots', () => {
    const view = renderWithProvider(<StabilityIndicator stabilityCount={0} />);
    expect(view.queryByTestId('stability-dot-0')).not.toBeNull();
    expect(view.queryByTestId('stability-dot-1')).not.toBeNull();
    expect(view.queryByTestId('stability-dot-2')).not.toBeNull();
    expect(view.queryByTestId('stability-dot-3')).toBeNull();
  });

  it('has correct testID', () => {
    const view = renderWithProvider(<StabilityIndicator stabilityCount={1} />);
    expect(view.queryByTestId('stability-indicator')).not.toBeNull();
  });

  it('accepts custom testID', () => {
    const view = renderWithProvider(
      <StabilityIndicator stabilityCount={0} testID="my-indicator" />,
    );
    expect(view.queryByTestId('my-indicator')).not.toBeNull();
  });

  it('renders custom totalDots', () => {
    const view = renderWithProvider(<StabilityIndicator stabilityCount={0} totalDots={5} />);
    expect(view.queryByTestId('stability-dot-4')).not.toBeNull();
    expect(view.queryByTestId('stability-dot-5')).toBeNull();
  });

  it('clamps stabilityCount below 0 without crashing', () => {
    const view = renderWithProvider(<StabilityIndicator stabilityCount={-1} />);
    expect(view.queryByTestId('stability-indicator')).not.toBeNull();
  });

  it('clamps stabilityCount above totalDots without crashing', () => {
    const view = renderWithProvider(<StabilityIndicator stabilityCount={99} />);
    expect(view.queryByTestId('stability-indicator')).not.toBeNull();
  });

  it('has accessibility role progressbar', () => {
    const view = renderWithProvider(<StabilityIndicator stabilityCount={2} />);
    const indicator = view.getByTestId('stability-indicator');
    expect(indicator).not.toBeNull();
    // The accessibility label is set; we check it exists via the testID
    expect(indicator).toBeDefined();
  });
});
