import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { PrintingDto } from '@binderly/api-contracts';

import { PrintingTile } from './PrintingTile';
import { renderWithProvider } from '../../test-utils/render';

function makePrinting(
  partial: Partial<PrintingDto> & { id: string; cardId: string },
): PrintingDto {
  return {
    id: partial.id,
    variantKey: partial.variantKey ?? `${partial.cardId}-${partial.id}`,
    cardId: partial.cardId,
    variantClass: partial.variantClass ?? 'NON_HOLO',
    variantFlags: partial.variantFlags ?? [],
    variantCode: partial.variantCode ?? 'std',
    includeInMasterSet: partial.includeInMasterSet ?? true,
    imageSmallUrl: partial.imageSmallUrl ?? null,
    imageLargeUrl: partial.imageLargeUrl ?? null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

describe('<PrintingTile>', () => {
  it('renders the variant class label and an Owned status when owned', () => {
    const onPress = vi.fn();
    const result = renderWithProvider(
      <PrintingTile
        printing={makePrinting({ id: 'p1', cardId: 'c1', variantClass: 'HOLO' })}
        owned
        onPress={onPress}
      />,
    );
    expect(result.container.textContent).toContain('Holo');
    expect(result.container.textContent).toContain('Owned');
  });

  it('renders a Missing status label when the printing is not owned', () => {
    const onPress = vi.fn();
    const result = renderWithProvider(
      <PrintingTile
        printing={makePrinting({ id: 'p2', cardId: 'c1', variantClass: 'REVERSE_HOLO' })}
        owned={false}
        onPress={onPress}
      />,
    );
    expect(result.container.textContent).toContain('Reverse Holo');
    expect(result.container.textContent).toContain('Missing');
  });

  it('invokes onPress with the printing when tapped', () => {
    const onPress = vi.fn();
    const printing = makePrinting({ id: 'p1', cardId: 'c1' });
    const result = renderWithProvider(
      <PrintingTile printing={printing} owned onPress={onPress} />,
    );
    fireEvent.click(result.getByTestId('collection-printing-tile-p1'));
    expect(onPress).toHaveBeenCalledWith(printing);
  });

  it('lists variant flags when present', () => {
    const onPress = vi.fn();
    const printing = makePrinting({
      id: 'p1',
      cardId: 'c1',
      variantClass: 'HOLO',
      variantFlags: ['FIRST_EDITION', 'STAMPED_PRERELEASE'],
    });
    const result = renderWithProvider(
      <PrintingTile printing={printing} owned onPress={onPress} />,
    );
    expect(result.container.textContent).toContain('First Edition');
    expect(result.container.textContent).toContain('Stamped Prerelease');
  });
});
