import { fireEvent } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProvider } from '../../../test-utils/render.js';
import {
  buildDisambigCandidates,
  DisambigPicker,
} from '../DisambigPicker.js';

import type { AnnSearchResult } from '../../ann/types.js';
import type { DisambigCandidate } from '../DisambigPicker.js';

const CANDIDATES: DisambigCandidate[] = [
  { printingId: 'a1', score: 0.72, displayName: 'Charizard', setName: 'Base Set', collectorNumber: '4/102' },
  { printingId: 'a2', score: 0.68, displayName: 'Charmeleon', setName: 'Base Set', collectorNumber: '24/102' },
  { printingId: 'a3', score: 0.65, displayName: 'Charmander', setName: 'Base Set', collectorNumber: '46/102' },
];

describe('<DisambigPicker>', () => {
  it('renders all candidate rows', () => {
    const view = renderWithProvider(
      <DisambigPicker
        candidates={CANDIDATES}
        onConfirm={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(view.queryByTestId('disambig-candidate-0')).not.toBeNull();
    expect(view.queryByTestId('disambig-candidate-1')).not.toBeNull();
    expect(view.queryByTestId('disambig-candidate-2')).not.toBeNull();
  });

  it('calls onConfirm with the correct printingId when a candidate is clicked', () => {
    const onConfirm = vi.fn();
    const view = renderWithProvider(
      <DisambigPicker
        candidates={CANDIDATES}
        onConfirm={onConfirm}
        onDismiss={vi.fn()}
      />,
    );
    fireEvent.click(view.getByTestId('disambig-candidate-1'));
    expect(onConfirm).toHaveBeenCalledWith('a2');
  });

  it('calls onDismiss when Cancel is clicked', () => {
    const onDismiss = vi.fn();
    const view = renderWithProvider(
      <DisambigPicker
        candidates={CANDIDATES}
        onConfirm={vi.fn()}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(view.getByTestId('disambig-dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders the empty state when no candidates are provided', () => {
    const view = renderWithProvider(
      <DisambigPicker
        candidates={[]}
        onConfirm={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(view.queryByTestId('disambig-no-candidates')).not.toBeNull();
  });

  it('has the correct default testID', () => {
    const view = renderWithProvider(
      <DisambigPicker
        candidates={CANDIDATES}
        onConfirm={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(view.queryByTestId('disambig-picker')).not.toBeNull();
  });

  it('accepts custom testID', () => {
    const view = renderWithProvider(
      <DisambigPicker
        candidates={CANDIDATES}
        onConfirm={vi.fn()}
        onDismiss={vi.fn()}
        testID="my-picker"
      />,
    );
    expect(view.queryByTestId('my-picker')).not.toBeNull();
  });

  it('shows confidence percentages', () => {
    const view = renderWithProvider(
      <DisambigPicker
        candidates={CANDIDATES}
        onConfirm={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(view.container.textContent).toContain('72%');
  });

  it('shows "Which card is this?" prompt', () => {
    const view = renderWithProvider(
      <DisambigPicker
        candidates={CANDIDATES}
        onConfirm={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(view.container.textContent).toContain('Which card is this?');
  });
});

describe('buildDisambigCandidates', () => {
  const annResults: AnnSearchResult[] = [
    { printingId: 'p1', score: 0.9, distance: 0.1 },
    { printingId: 'p2', score: 0.7, distance: 0.3 },
    { printingId: 'p3', score: 0.6, distance: 0.4 },
    { printingId: 'p4', score: 0.5, distance: 0.5 },
  ];

  it('limits output to top 3', () => {
    const result = buildDisambigCandidates(annResults);
    expect(result).toHaveLength(3);
  });

  it('maps printingId and score correctly', () => {
    const result = buildDisambigCandidates(annResults);
    expect(result[0]?.printingId).toBe('p1');
    expect(result[0]?.score).toBe(0.9);
  });

  it('uses default name lookup (falls back to id)', () => {
    const result = buildDisambigCandidates(annResults);
    expect(result[0]?.displayName).toBe('p1');
  });

  it('uses custom name lookup when provided', () => {
    const result = buildDisambigCandidates(annResults, (id) => ({
      displayName: `Card(${id})`,
      setName: 'MySet',
      collectorNumber: '1/100',
    }));
    expect(result[0]?.displayName).toBe('Card(p1)');
    expect(result[0]?.setName).toBe('MySet');
  });

  it('handles empty array', () => {
    expect(buildDisambigCandidates([])).toHaveLength(0);
  });
});
