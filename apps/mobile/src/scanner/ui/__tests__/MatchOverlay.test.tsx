import React from 'react';
import { describe, expect, it } from 'vitest';

import { renderWithProvider } from '../../../test-utils/render.js';
import { HoldSteadyHint, MatchOverlay } from '../MatchOverlay.js';

describe('<MatchOverlay>', () => {
  it('renders the printing name', () => {
    const view = renderWithProvider(
      <MatchOverlay
        printingName="Charizard"
        setName="Base Set"
        collectorNumber="4/102"
        stabilityCount={3}
        confidence={0.92}
      />,
    );
    expect(view.container.textContent).toContain('Charizard');
  });

  it('renders the set + collector number', () => {
    const view = renderWithProvider(
      <MatchOverlay
        printingName="Pikachu"
        setName="Jungle"
        collectorNumber="60/64"
        stabilityCount={3}
        confidence={0.85}
      />,
    );
    expect(view.container.textContent).toContain('Jungle');
    expect(view.container.textContent).toContain('60/64');
  });

  it('renders confidence percentage', () => {
    const view = renderWithProvider(
      <MatchOverlay
        printingName="Blastoise"
        setName="Base Set"
        collectorNumber="2/102"
        stabilityCount={2}
        confidence={0.834}
      />,
    );
    expect(view.container.textContent).toContain('83%');
  });

  it('renders ellipsis for empty name', () => {
    const view = renderWithProvider(
      <MatchOverlay
        printingName=""
        setName=""
        collectorNumber=""
        stabilityCount={1}
        confidence={0.8}
      />,
    );
    expect(view.container.textContent).toContain('…');
  });

  it('has the match-overlay testID by default', () => {
    const view = renderWithProvider(
      <MatchOverlay
        printingName="Mewtwo"
        setName="Base Set"
        collectorNumber="10/102"
        stabilityCount={3}
        confidence={0.95}
      />,
    );
    expect(view.queryByTestId('match-overlay')).not.toBeNull();
  });

  it('accepts custom testID', () => {
    const view = renderWithProvider(
      <MatchOverlay
        printingName="Mewtwo"
        setName="Base Set"
        collectorNumber="10/102"
        stabilityCount={3}
        confidence={0.95}
        testID="custom-overlay"
      />,
    );
    expect(view.queryByTestId('custom-overlay')).not.toBeNull();
  });

  it('renders the stability indicator inside the overlay', () => {
    const view = renderWithProvider(
      <MatchOverlay
        printingName="Raichu"
        setName="Base Set"
        collectorNumber="14/102"
        stabilityCount={2}
        confidence={0.8}
      />,
    );
    expect(view.queryByTestId('stability-indicator')).not.toBeNull();
  });

  it('shows all overlay testIDs', () => {
    const view = renderWithProvider(
      <MatchOverlay
        printingName="Venusaur"
        setName="Base Set"
        collectorNumber="15/102"
        stabilityCount={3}
        confidence={0.9}
      />,
    );
    expect(view.queryByTestId('match-overlay-name')).not.toBeNull();
    expect(view.queryByTestId('match-overlay-set')).not.toBeNull();
    expect(view.queryByTestId('match-overlay-confidence')).not.toBeNull();
  });
});

describe('<HoldSteadyHint>', () => {
  it('renders hold steady copy', () => {
    const view = renderWithProvider(<HoldSteadyHint />);
    expect(view.queryByTestId('hold-steady-hint')).not.toBeNull();
    expect(view.container.textContent).toContain('Hold steady');
  });

  it('accepts custom testID', () => {
    const view = renderWithProvider(<HoldSteadyHint testID="my-hint" />);
    expect(view.queryByTestId('my-hint')).not.toBeNull();
  });
});
