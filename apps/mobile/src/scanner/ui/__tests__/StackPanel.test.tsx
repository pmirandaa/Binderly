import { fireEvent } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProvider } from '../../../test-utils/render.js';
import { StackPanel } from '../StackPanel.js';

import type { MatchResult } from '../../match/types.js';
import type { SessionItem } from '../types.js';

function makeItem(i: number): SessionItem {
  return {
    collectionItemId: `cid-${i}`,
    printingId: `pid-${i}`,
    displayName: `Card ${i}`,
    committedAt: new Date().toISOString(),
    matchResult: {
      printingId: `pid-${i}`,
      confidence: 0.85,
      topGap: 0.08,
      disposition: 'auto-add',
      candidates: [],
      stabilityCount: 3,
      framesSinceMatch: 0,
      emittedAtMs: 1000 + i,
    } satisfies MatchResult,
  };
}

const ITEMS = [makeItem(0), makeItem(1), makeItem(2)];

describe('<StackPanel>', () => {
  it('renders all items', () => {
    const view = renderWithProvider(
      <StackPanel
        items={ITEMS}
        onRemoveItem={vi.fn()}
        onCommit={vi.fn()}
        onDiscardAll={vi.fn()}
      />,
    );
    expect(view.queryByTestId('stack-panel-item-0')).not.toBeNull();
    expect(view.queryByTestId('stack-panel-item-1')).not.toBeNull();
    expect(view.queryByTestId('stack-panel-item-2')).not.toBeNull();
  });

  it('calls onRemoveItem with the correct id when Remove is clicked', () => {
    const onRemoveItem = vi.fn();
    const view = renderWithProvider(
      <StackPanel
        items={ITEMS}
        onRemoveItem={onRemoveItem}
        onCommit={vi.fn()}
        onDiscardAll={vi.fn()}
      />,
    );
    fireEvent.click(view.getByTestId('stack-panel-remove-1'));
    expect(onRemoveItem).toHaveBeenCalledWith('cid-1');
  });

  it('calls onCommit when Commit is clicked', () => {
    const onCommit = vi.fn();
    const view = renderWithProvider(
      <StackPanel
        items={ITEMS}
        onRemoveItem={vi.fn()}
        onCommit={onCommit}
        onDiscardAll={vi.fn()}
      />,
    );
    fireEvent.click(view.getByTestId('stack-panel-commit'));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('calls onDiscardAll when Discard all is clicked', () => {
    const onDiscardAll = vi.fn();
    const view = renderWithProvider(
      <StackPanel
        items={ITEMS}
        onRemoveItem={vi.fn()}
        onCommit={vi.fn()}
        onDiscardAll={onDiscardAll}
      />,
    );
    fireEvent.click(view.getByTestId('stack-panel-discard-all'));
    expect(onDiscardAll).toHaveBeenCalledTimes(1);
  });

  it('shows singular item count in title', () => {
    const view = renderWithProvider(
      <StackPanel
        items={[makeItem(0)]}
        onRemoveItem={vi.fn()}
        onCommit={vi.fn()}
        onDiscardAll={vi.fn()}
      />,
    );
    expect(view.container.textContent).toContain('1 card scanned');
  });

  it('shows plural item count in title', () => {
    const view = renderWithProvider(
      <StackPanel
        items={ITEMS}
        onRemoveItem={vi.fn()}
        onCommit={vi.fn()}
        onDiscardAll={vi.fn()}
      />,
    );
    expect(view.container.textContent).toContain('3 cards scanned');
  });

  it('shows empty state when no items', () => {
    const view = renderWithProvider(
      <StackPanel
        items={[]}
        onRemoveItem={vi.fn()}
        onCommit={vi.fn()}
        onDiscardAll={vi.fn()}
      />,
    );
    expect(view.queryByTestId('stack-panel-empty')).not.toBeNull();
  });

  it('shows "Done" on commit button when no items', () => {
    const view = renderWithProvider(
      <StackPanel
        items={[]}
        onRemoveItem={vi.fn()}
        onCommit={vi.fn()}
        onDiscardAll={vi.fn()}
      />,
    );
    expect(view.container.textContent).toContain('Done');
  });

  it('accepts custom testID', () => {
    const view = renderWithProvider(
      <StackPanel
        items={[]}
        onRemoveItem={vi.fn()}
        onCommit={vi.fn()}
        onDiscardAll={vi.fn()}
        testID="my-panel"
      />,
    );
    expect(view.queryByTestId('my-panel')).not.toBeNull();
  });
});
