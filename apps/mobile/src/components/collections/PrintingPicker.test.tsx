import { act, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CollectionItemDto } from '@binderly/api-contracts';

import { PrintingPicker } from './PrintingPicker';
import { renderWithProvider } from '../../test-utils/render';

function makeItem(partial: Partial<CollectionItemDto> & { id: string; printingId: string }): CollectionItemDto {
  return {
    id: partial.id,
    userId: partial.userId ?? '00000000-0000-4000-8000-000000000001',
    printingId: partial.printingId,
    quantity: partial.quantity ?? 1,
    condition: partial.condition ?? 'NEAR_MINT',
    gradeCompany: partial.gradeCompany ?? null,
    grade: partial.grade ?? null,
    acquiredAt: partial.acquiredAt ?? null,
    acquiredPrice: partial.acquiredPrice ?? null,
    acquiredCurrency: partial.acquiredCurrency ?? null,
    notes: partial.notes ?? null,
    photoUrls: partial.photoUrls ?? [],
    source: partial.source ?? 'manual',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

describe('<PrintingPicker>', () => {
  it('renders a sign-in friendly empty state when no owned items', () => {
    const result = renderWithProvider(
      <PrintingPicker
        ownedItems={[]}
        existingPrintingIds={[]}
        onAdd={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(result.queryByTestId('printing-picker-empty')).not.toBeNull();
    expect(result.container.textContent).toContain('own any cards');
  });

  it('renders an Add button per owned printing', () => {
    const items = [
      makeItem({ id: 'i1', printingId: '11111111-2222-4333-8444-555555555551' }),
      makeItem({ id: 'i2', printingId: '11111111-2222-4333-8444-555555555552' }),
    ];
    const result = renderWithProvider(
      <PrintingPicker
        ownedItems={items}
        existingPrintingIds={[]}
        onAdd={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(
      result.queryByTestId(
        'printing-picker-row-11111111-2222-4333-8444-555555555551-add',
      ),
    ).not.toBeNull();
    expect(
      result.queryByTestId(
        'printing-picker-row-11111111-2222-4333-8444-555555555552-add',
      ),
    ).not.toBeNull();
  });

  it('hides the Add button + shows "Already added" for existing printings', () => {
    const items = [
      makeItem({ id: 'i1', printingId: '11111111-2222-4333-8444-555555555551' }),
    ];
    const result = renderWithProvider(
      <PrintingPicker
        ownedItems={items}
        existingPrintingIds={['11111111-2222-4333-8444-555555555551']}
        onAdd={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(
      result.queryByTestId(
        'printing-picker-row-11111111-2222-4333-8444-555555555551-add',
      ),
    ).toBeNull();
    expect(
      result.queryByTestId(
        'printing-picker-row-11111111-2222-4333-8444-555555555551-existing',
      ),
    ).not.toBeNull();
  });

  it('forwards onAdd with the printing id', () => {
    const onAdd = vi.fn();
    const items = [
      makeItem({ id: 'i1', printingId: '11111111-2222-4333-8444-555555555551' }),
    ];
    const result = renderWithProvider(
      <PrintingPicker
        ownedItems={items}
        existingPrintingIds={[]}
        onAdd={onAdd}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(
      result.getByTestId(
        'printing-picker-row-11111111-2222-4333-8444-555555555551-add',
      ),
    );
    expect(onAdd).toHaveBeenCalledWith('11111111-2222-4333-8444-555555555551');
  });

  it('forwards onClose when Done is tapped', () => {
    const onClose = vi.fn();
    const items = [
      makeItem({ id: 'i1', printingId: '11111111-2222-4333-8444-555555555551' }),
    ];
    const result = renderWithProvider(
      <PrintingPicker
        ownedItems={items}
        existingPrintingIds={[]}
        onAdd={vi.fn()}
        onClose={onClose}
      />,
    );
    fireEvent.click(result.getByTestId('printing-picker-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('filters by the search input', () => {
    const items = [
      makeItem({ id: 'i1', printingId: 'aaaaaaaa-1111-4111-8111-111111111111' }),
      makeItem({ id: 'i2', printingId: 'bbbbbbbb-2222-4222-8222-222222222222' }),
    ];
    const result = renderWithProvider(
      <PrintingPicker
        ownedItems={items}
        existingPrintingIds={[]}
        onAdd={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const input = result.container.querySelector('input');
    if (input === null) throw new Error('expected input');
    act(() => {
      fireEvent.change(input, { target: { value: 'aaaa' } });
    });
    expect(
      result.queryByTestId(
        'printing-picker-row-aaaaaaaa-1111-4111-8111-111111111111',
      ),
    ).not.toBeNull();
    expect(
      result.queryByTestId(
        'printing-picker-row-bbbbbbbb-2222-4222-8222-222222222222',
      ),
    ).toBeNull();
  });

  it('shows "no matches" when search filters everything out', () => {
    const items = [
      makeItem({ id: 'i1', printingId: 'aaaaaaaa-1111-4111-8111-111111111111' }),
    ];
    const result = renderWithProvider(
      <PrintingPicker
        ownedItems={items}
        existingPrintingIds={[]}
        onAdd={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const input = result.container.querySelector('input');
    if (input === null) throw new Error('expected input');
    act(() => {
      fireEvent.change(input, { target: { value: 'zzz' } });
    });
    expect(result.queryByTestId('printing-picker-no-matches')).not.toBeNull();
  });
});
