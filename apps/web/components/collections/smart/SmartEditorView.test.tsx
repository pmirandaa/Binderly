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
  it('runs the expression against the catalog preview and renders the match grid', async () => {
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
    // swsh (en, 2 printings); JP card name is "リザードン" so it
    // does NOT match `card.name === 'Charizard'`. 4 of 7 scanned.
    expect(screen.getByTestId('smart-editor-results-summary').textContent).toContain(
      '4 matches of 7 scanned',
    );
    expect(screen.getAllByTestId('smart-match-tile').length).toBe(4);
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
