import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SmartEditorView } from './SmartEditorView';
import {
  createFakeSmartCollectionsApi,
  makeSubscription,
} from '../../../lib/collections/smart/fixtures';
import { renderWithProviders } from '../../../test-utils/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/collections/smart/new',
  useSearchParams: () => new URLSearchParams(),
}));

const VALID_EXPRESSION = JSON.stringify({
  type: 'eq',
  field: 'card.name',
  value: 'Charizard',
});

describe('SmartEditorView — parse feedback', () => {
  it('shows the explainer immediately for the default valid template', async () => {
    const api = createFakeSmartCollectionsApi();
    renderWithProviders(<SmartEditorView api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('smart-editor-parse-explanation')).toBeInTheDocument();
    });
    expect(screen.getByTestId('smart-editor-parse-explanation').textContent).toContain(
      'Charizard',
    );
  });

  it('shows the empty hint when the textarea is cleared', async () => {
    const api = createFakeSmartCollectionsApi();
    renderWithProviders(<SmartEditorView api={api} initialText="" />);
    await waitFor(() => {
      expect(screen.getByTestId('smart-editor-parse-empty')).toBeInTheDocument();
    });
  });

  it('flags malformed JSON inline', async () => {
    const api = createFakeSmartCollectionsApi();
    renderWithProviders(<SmartEditorView api={api} initialText="{ not json" />);
    await waitFor(() => {
      expect(screen.getByTestId('smart-editor-parse-json-error')).toBeInTheDocument();
    });
  });

  it('flags valid JSON with an invalid DSL shape', async () => {
    const api = createFakeSmartCollectionsApi();
    renderWithProviders(
      <SmartEditorView
        api={api}
        initialText={JSON.stringify({ type: 'eq', field: 'unknown.field', value: 'x' })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('smart-editor-parse-dsl-error')).toBeInTheDocument();
    });
  });

  it('updates the explainer as the textarea changes', async () => {
    const api = createFakeSmartCollectionsApi();
    renderWithProviders(<SmartEditorView api={api} initialText={VALID_EXPRESSION} />);
    await waitFor(() => {
      expect(screen.getByTestId('smart-editor-parse-explanation')).toBeInTheDocument();
    });
    const textarea = screen.getByTestId('smart-editor-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: {
        value: JSON.stringify({ type: 'eq', field: 'card.name', value: 'Pikachu' }),
      },
    });
    await waitFor(() => {
      expect(screen.getByTestId('smart-editor-parse-explanation').textContent).toContain(
        'Pikachu',
      );
    });
  });
});

describe('SmartEditorView — Run', () => {
  it('calls the server preview and renders the returned matches', async () => {
    const api = createFakeSmartCollectionsApi();
    renderWithProviders(<SmartEditorView api={api} initialText={VALID_EXPRESSION} />);
    await waitFor(() => {
      expect(screen.getByTestId('smart-editor-run')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('smart-editor-run'));
    await waitFor(() => {
      expect(screen.getByTestId('smart-editor-results-summary')).toBeInTheDocument();
    });
    // Fixture has three "Charizard" cards — base (en, 2 printings),
    // swsh (en, 2 printings); JP card name is "リザードン" so the
    // VALID_EXPRESSION (card.name === 'Charizard') matches all 4
    // English printings + the JP card's `name` is different so it
    // does not match. 4 matches total.
    expect(api.runServerPreview).toHaveBeenCalledTimes(1);
    expect(api.runServerPreview.mock.calls[0]?.[0]).toMatchObject({
      expression: { type: 'eq', field: 'card.name', value: 'Charizard' },
    });
    expect(screen.getByTestId('smart-editor-results-summary').textContent).toContain(
      '4 matches of 4 total',
    );
    expect(screen.getAllByTestId('smart-match-tile').length).toBe(4);
  });

  it('does NOT call the local evaluator when the server preview succeeds', async () => {
    const api = createFakeSmartCollectionsApi();
    renderWithProviders(<SmartEditorView api={api} initialText={VALID_EXPRESSION} />);
    await waitFor(() => {
      expect(screen.getByTestId('smart-editor-run')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('smart-editor-run'));
    await waitFor(() => {
      expect(screen.getByTestId('smart-editor-results-summary')).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId('smart-editor-results-local-fallback'),
    ).toBeNull();
  });

  it('surfaces a Run failure inline without crashing the page', async () => {
    const api = createFakeSmartCollectionsApi({
      rejectServerPreview: new Error('worker timed out'),
    });
    renderWithProviders(<SmartEditorView api={api} initialText={VALID_EXPRESSION} />);
    await waitFor(() => {
      expect(screen.getByTestId('smart-editor-run')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('smart-editor-run'));
    await waitFor(() => {
      expect(screen.getByTestId('smart-editor-run-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('smart-editor-run-error').textContent).toContain(
      'worker timed out',
    );
    expect(screen.queryByTestId('smart-editor-results-summary')).toBeNull();
  });

  it('falls back to the local evaluator when the server rejects a `collection.*` predicate', async () => {
    const { ApiValidationError } = await import('@binderly/api-client');
    const api = createFakeSmartCollectionsApi({
      rejectServerPreview: new ApiValidationError(
        'collection.* predicates are not supported by the server preview yet',
      ),
    });
    const COLLECTION_EXPRESSION = JSON.stringify({
      type: 'and',
      children: [
        { type: 'eq', field: 'card.name', value: 'Charizard' },
        { type: 'eq', field: 'collection.isOwned', value: true },
      ],
    });
    renderWithProviders(
      <SmartEditorView api={api} initialText={COLLECTION_EXPRESSION} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('smart-editor-run')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('smart-editor-run'));
    await waitFor(() => {
      expect(screen.getByTestId('smart-editor-results-local-fallback')).toBeInTheDocument();
    });
    expect(
      screen.getByTestId('smart-editor-results-local-fallback').textContent,
    ).toContain('Using local preview');
    // 0 matches because the editor's local fallback runs with an
    // empty owned-items array (the editor only fetches ownedItems
    // count for stats, not the full list).
    expect(screen.getByTestId('smart-editor-results-summary').textContent).toContain(
      '0 matches',
    );
  });

  it('Run is disabled while the textarea has a parse error', async () => {
    const api = createFakeSmartCollectionsApi();
    renderWithProviders(<SmartEditorView api={api} initialText="not json" />);
    await waitFor(() => {
      expect(screen.getByTestId('smart-editor-run')).toBeInTheDocument();
    });
    expect(screen.getByTestId('smart-editor-run').getAttribute('aria-disabled')).toBe(
      'true',
    );
    expect(api.runServerPreview).not.toHaveBeenCalled();
  });

  it('surfaces the truncation note when the server reports more matches than the current page', async () => {
    const api = createFakeSmartCollectionsApi();
    // Override the server preview to return a single match while
    // signalling that more pages exist via a non-null nextOffset.
    api.runServerPreview.mockResolvedValueOnce({
      items: [
        {
          printingId: 'p-base-charizard-holo',
          cardId: 'card-base-charizard',
          setId: 'set-base',
          cardName: 'Charizard',
          cardNumber: '4',
          setName: 'Base Set',
          setCode: 'base1',
          variantLabel: 'holo',
          imageSmallUrl: null,
        },
      ],
      totalCount: 12,
      nextOffset: 1,
    });
    renderWithProviders(<SmartEditorView api={api} initialText={VALID_EXPRESSION} />);
    await waitFor(() => {
      expect(screen.getByTestId('smart-editor-run')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('smart-editor-run'));
    await waitFor(() => {
      expect(screen.getByTestId('smart-editor-results-truncated')).toBeInTheDocument();
    });
    expect(screen.getByTestId('smart-editor-results-summary').textContent).toContain(
      '1 match of 12 total',
    );
  });
});

describe('SmartEditorView — save (free vs pro gating)', () => {
  it('disables Save with the upsell tooltip for free users', async () => {
    const api = createFakeSmartCollectionsApi();
    renderWithProviders(<SmartEditorView api={api} initialText={VALID_EXPRESSION} />);
    await waitFor(() => {
      expect(screen.getByTestId('smart-editor-save')).toBeInTheDocument();
    });
    expect(screen.getByTestId('smart-editor-save').getAttribute('aria-disabled')).toBe(
      'true',
    );
    expect(
      screen.getByTestId('smart-editor-save-tooltip').getAttribute('title'),
    ).toContain('paid plan');
    expect(screen.getByTestId('smart-editor-save-helper')).toBeInTheDocument();
  });

  it('enables Save for pro users and surfaces the modal', async () => {
    const api = createFakeSmartCollectionsApi({
      subscription: makeSubscription({ tier: 'pro' }),
    });
    renderWithProviders(<SmartEditorView api={api} initialText={VALID_EXPRESSION} />);
    await waitFor(() => {
      expect(screen.getByTestId('smart-editor-save')).toBeInTheDocument();
    });
    const saveBtn = screen.getByTestId('smart-editor-save');
    expect(saveBtn.getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.click(saveBtn);
    expect(screen.getByTestId('smart-editor-save-modal')).toBeInTheDocument();
  });

  it('submits the modal and calls onSaved with the new id', async () => {
    const onSaved = vi.fn();
    const api = createFakeSmartCollectionsApi({
      subscription: makeSubscription({ tier: 'pro' }),
    });
    renderWithProviders(
      <SmartEditorView api={api} initialText={VALID_EXPRESSION} onSaved={onSaved} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('smart-editor-save')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('smart-editor-save'));
    const nameInput = screen.getByTestId('smart-editor-save-name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'My Charizards' } });
    fireEvent.click(screen.getByTestId('smart-editor-save-submit'));
    await waitFor(() => {
      expect(api.createSmartCollection).toHaveBeenCalledTimes(1);
    });
    expect(api.createSmartCollection.mock.calls[0]?.[0]).toMatchObject({
      kind: 'smart',
      name: 'My Charizards',
      slug: 'my-charizards',
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith('cc-smart-new');
    });
  });

  it('rejects submission with an empty name and surfaces the validation error', async () => {
    const api = createFakeSmartCollectionsApi({
      subscription: makeSubscription({ tier: 'pro' }),
    });
    renderWithProviders(<SmartEditorView api={api} initialText={VALID_EXPRESSION} />);
    await waitFor(() => {
      expect(screen.getByTestId('smart-editor-save')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('smart-editor-save'));
    fireEvent.click(screen.getByTestId('smart-editor-save-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('smart-editor-save-error').textContent).toContain(
        'Name is required',
      );
    });
    expect(api.createSmartCollection).not.toHaveBeenCalled();
  });

  it('surfaces api errors inline without redirecting', async () => {
    const onSaved = vi.fn();
    const api = createFakeSmartCollectionsApi({
      subscription: makeSubscription({ tier: 'pro' }),
      rejectCreate: new Error('slug taken'),
    });
    renderWithProviders(
      <SmartEditorView api={api} initialText={VALID_EXPRESSION} onSaved={onSaved} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('smart-editor-save')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('smart-editor-save'));
    fireEvent.change(screen.getByTestId('smart-editor-save-name'), {
      target: { value: 'X' },
    });
    fireEvent.click(screen.getByTestId('smart-editor-save-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('smart-editor-save-error').textContent).toContain(
        'slug taken',
      );
    });
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe('SmartEditorView — error & loading', () => {
  it('renders an error state when the catalog preview fetch fails', async () => {
    const api = createFakeSmartCollectionsApi({
      rejectPreview: new Error('catalog read failed'),
    });
    renderWithProviders(<SmartEditorView api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('smart-editor-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('smart-editor-error').textContent).toContain(
      'catalog read failed',
    );
  });
});
