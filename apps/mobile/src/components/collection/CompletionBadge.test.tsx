import { describe, expect, it } from 'vitest';

import { CompletionBadge } from './CompletionBadge';
import { renderWithProvider } from '../../test-utils/render';

import type { CollectionGlobalSummary } from '../../lib/collection/index.js';

const ZERO_SUMMARY: CollectionGlobalSummary = {
  allPokemonPct: 0,
  uniqueCardsOwned: 0,
  uniqueCardsTotal: 0,
  setsStarted: 0,
  setsMastered: 0,
  masterPct: 0,
  masterOwned: 0,
  masterTotal: 0,
};

describe('<CompletionBadge>', () => {
  it('renders the All Pokémon % headline', () => {
    const result = renderWithProvider(
      <CompletionBadge
        summary={{
          ...ZERO_SUMMARY,
          allPokemonPct: 42,
          uniqueCardsOwned: 100,
          uniqueCardsTotal: 240,
        }}
      />,
    );
    expect(result.container.textContent).toContain('42%');
    expect(result.container.textContent).toContain('100/240');
  });

  it('renders the sets-started + sets-mastered counters', () => {
    const result = renderWithProvider(
      <CompletionBadge
        summary={{
          ...ZERO_SUMMARY,
          setsStarted: 5,
          setsMastered: 2,
        }}
      />,
    );
    const counters = result.getByTestId('collection-global-badge-counters');
    expect(counters.textContent).toContain('5');
    expect(counters.textContent).toContain('Sets started');
    expect(counters.textContent).toContain('2');
    expect(counters.textContent).toContain('Sets mastered');
  });
});
