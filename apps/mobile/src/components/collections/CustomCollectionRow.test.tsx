import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CustomCollectionDto } from '@binderly/api-contracts';

import { CustomCollectionRow } from './CustomCollectionRow';
import { renderWithProvider } from '../../test-utils/render';

function makeCollection(partial: Partial<CustomCollectionDto> & { id: string }): CustomCollectionDto {
  return {
    id: partial.id,
    userId: partial.userId ?? '00000000-0000-4000-8000-000000000001',
    name: partial.name ?? 'My Charizards',
    slug: partial.slug ?? 'my-charizards',
    kind: partial.kind ?? 'manual',
    description: partial.description ?? null,
    coverUrl: partial.coverUrl ?? null,
    createdAt: partial.createdAt ?? '2024-01-01T00:00:00Z',
    updatedAt: partial.updatedAt ?? '2024-01-01T00:00:00Z',
  };
}

describe('<CustomCollectionRow>', () => {
  it('renders the name and updated label', () => {
    const result = renderWithProvider(
      <CustomCollectionRow
        collection={makeCollection({ id: 'c1', name: 'Bulbasaurs' })}
        onPress={vi.fn()}
      />,
    );
    expect(result.container.textContent).toContain('Bulbasaurs');
    expect(result.container.textContent).toContain('Updated');
  });

  it('renders a Manual chip for manual kind', () => {
    const result = renderWithProvider(
      <CustomCollectionRow
        collection={makeCollection({ id: 'c1', kind: 'manual' })}
        onPress={vi.fn()}
      />,
    );
    expect(result.getByTestId('custom-collection-row-c1-kind').textContent).toContain('Manual');
  });

  it('renders a Smart chip for smart kind', () => {
    const result = renderWithProvider(
      <CustomCollectionRow
        collection={makeCollection({ id: 'c2', kind: 'smart' })}
        onPress={vi.fn()}
      />,
    );
    expect(result.getByTestId('custom-collection-row-c2-kind').textContent).toContain('Smart');
  });

  it('renders the description when present', () => {
    const result = renderWithProvider(
      <CustomCollectionRow
        collection={makeCollection({ id: 'c1', description: 'Every Charizard' })}
        onPress={vi.fn()}
      />,
    );
    expect(result.container.textContent).toContain('Every Charizard');
  });

  it('fires onPress with the collection when tapped', () => {
    const onPress = vi.fn();
    const collection = makeCollection({ id: 'c1' });
    const result = renderWithProvider(
      <CustomCollectionRow collection={collection} onPress={onPress} />,
    );
    fireEvent.click(result.getByTestId('custom-collection-row-c1'));
    expect(onPress).toHaveBeenCalledWith(collection);
  });
});
