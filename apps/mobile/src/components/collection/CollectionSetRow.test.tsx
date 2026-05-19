import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { SetDto } from '@binderly/api-contracts';

import { CollectionSetRow } from './CollectionSetRow';
import { renderWithProvider } from '../../test-utils/render';

import type { CollectionSetSummary } from '../../lib/collection/index.js';

function makeSet(partial: Partial<SetDto> & { id: string }): SetDto {
  return {
    id: partial.id,
    canonicalKey: partial.canonicalKey ?? `en-${partial.id}`,
    code: partial.code ?? partial.id,
    language: partial.language ?? 'en',
    name: partial.name ?? `Set ${partial.id}`,
    series: partial.series ?? 'Series',
    releaseDate: partial.releaseDate ?? '2024-01-01',
    printedTotal: partial.printedTotal ?? null,
    total: 'total' in partial ? (partial.total ?? null) : 100,
    logoUrl: partial.logoUrl ?? null,
    symbolUrl: partial.symbolUrl ?? null,
    masterSetRules: {},
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

function makeSummary(partial: Partial<CollectionSetSummary>): CollectionSetSummary {
  return {
    set: partial.set ?? makeSet({ id: 'set-1', canonicalKey: 'en-set-1', name: 'Test' }),
    setPct: partial.setPct ?? 0,
    ownedNumbered: partial.ownedNumbered ?? 0,
    totalNumbered: partial.totalNumbered ?? 100,
    masterPct: partial.masterPct ?? 0,
    ownedMaster: partial.ownedMaster ?? 0,
    totalMaster: partial.totalMaster ?? 0,
    hasAnyOwned: partial.hasAnyOwned ?? false,
  };
}

describe('<CollectionSetRow>', () => {
  it('renders the set name + release date footnote', () => {
    const onPress = vi.fn();
    const result = renderWithProvider(
      <CollectionSetRow
        summary={makeSummary({
          set: makeSet({ id: 'a', name: 'Brilliant Stars', releaseDate: '2022-02-25' }),
        })}
        onPress={onPress}
      />,
    );
    expect(result.container.textContent).toContain('Brilliant Stars');
    expect(result.container.textContent).toContain('Feb 25, 2022');
  });

  it('shows the Set % progress bar with formatted owned/total', () => {
    const onPress = vi.fn();
    const result = renderWithProvider(
      <CollectionSetRow
        summary={makeSummary({
          set: makeSet({ id: 'a' }),
          setPct: 33.33,
          ownedNumbered: 33,
          totalNumbered: 100,
        })}
        onPress={onPress}
      />,
    );
    expect(result.container.textContent).toContain('33%');
    expect(result.container.textContent).toContain('33/100');
  });

  it('renders the Master % progress bar with formatted owned/total (no parked placeholder)', () => {
    // V2 swap (T-M-API-V2-WIRING): Master tallies are now real,
    // so the row drops the "Open set to compute" parked copy and
    // always renders `formatPercent · ownedMaster/totalMaster`.
    const onPress = vi.fn();
    const result = renderWithProvider(
      <CollectionSetRow
        summary={makeSummary({
          set: makeSet({ id: 'a' }),
          masterPct: 50,
          ownedMaster: 2,
          totalMaster: 4,
        })}
        onPress={onPress}
      />,
    );
    expect(result.container.textContent).not.toContain('Open set to compute');
    expect(result.container.textContent).toContain('50%');
    expect(result.container.textContent).toContain('2/4');
  });

  it('renders all-zero Master row when totalMaster is 0 (set absent from completion perSet)', () => {
    const onPress = vi.fn();
    const result = renderWithProvider(
      <CollectionSetRow
        summary={makeSummary({
          set: makeSet({ id: 'a' }),
          totalMaster: 0,
        })}
        onPress={onPress}
      />,
    );
    expect(result.container.textContent).not.toContain('Open set to compute');
    expect(result.container.textContent).toContain('0/0');
  });

  it('invokes onPress with the summary when the row is tapped', () => {
    const onPress = vi.fn();
    const summary = makeSummary({ set: makeSet({ id: 'a', canonicalKey: 'en-a' }) });
    const result = renderWithProvider(
      <CollectionSetRow summary={summary} onPress={onPress} />,
    );
    fireEvent.click(result.getByTestId('collection-set-row-en-a'));
    expect(onPress).toHaveBeenCalledWith(summary);
  });
});
