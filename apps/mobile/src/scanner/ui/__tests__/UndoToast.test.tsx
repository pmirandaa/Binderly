import { fireEvent } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProvider } from '../../../test-utils/render.js';
import { UndoToast } from '../UndoToast.js';

describe('<UndoToast>', () => {
  it('renders the card name in the label', () => {
    const view = renderWithProvider(
      <UndoToast displayName="Charizard" onUndo={vi.fn()} />,
    );
    expect(view.container.textContent).toContain('Charizard');
  });

  it('uses "card" when displayName is empty', () => {
    const view = renderWithProvider(
      <UndoToast displayName="" onUndo={vi.fn()} />,
    );
    expect(view.container.textContent).toContain('card');
  });

  it('calls onUndo when the Undo button is clicked', () => {
    const onUndo = vi.fn();
    const view = renderWithProvider(
      <UndoToast displayName="Pikachu" onUndo={onUndo} />,
    );
    fireEvent.click(view.getByTestId('undo-toast-button'));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('has correct default testID', () => {
    const view = renderWithProvider(
      <UndoToast displayName="Mewtwo" onUndo={vi.fn()} />,
    );
    expect(view.queryByTestId('undo-toast')).not.toBeNull();
  });

  it('accepts custom testID', () => {
    const view = renderWithProvider(
      <UndoToast displayName="Mewtwo" onUndo={vi.fn()} testID="my-toast" />,
    );
    expect(view.queryByTestId('my-toast')).not.toBeNull();
  });

  it('renders the undo toast label testID', () => {
    const view = renderWithProvider(
      <UndoToast displayName="Blastoise" onUndo={vi.fn()} />,
    );
    expect(view.queryByTestId('undo-toast-label')).not.toBeNull();
    expect(view.queryByTestId('undo-toast-button')).not.toBeNull();
  });

  it('shows "Added" prefix', () => {
    const view = renderWithProvider(
      <UndoToast displayName="Snorlax" onUndo={vi.fn()} />,
    );
    expect(view.container.textContent).toContain('Added');
  });
});
