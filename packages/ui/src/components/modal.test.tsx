import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Modal } from './modal.js';
import { renderWithProvider } from '../test-utils/render.js';

describe('<Modal>', () => {
  it('renders nothing when closed', () => {
    const { queryByTestId } = renderWithProvider(
      <Modal open={false} onClose={() => {}} title="Hi" testID="m">
        <span>body</span>
      </Modal>,
    );
    expect(queryByTestId('m')).toBeNull();
  });

  it('renders the title and children when open', () => {
    const { getByText, getByTestId } = renderWithProvider(
      <Modal open onClose={() => {}} title="My dialog" testID="m">
        <span>body content</span>
      </Modal>,
    );
    expect(getByText('My dialog')).toBeInTheDocument();
    expect(getByText('body content')).toBeInTheDocument();
    expect(getByTestId('m')).toBeInTheDocument();
  });

  it('exposes a dialog role with aria-modal', () => {
    const { getByRole } = renderWithProvider(
      <Modal open onClose={() => {}} title="Accessible" testID="m">
        <span>body</span>
      </Modal>,
    );
    const dialog = getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby');
  });

  it('calls onClose when the backdrop is pressed', () => {
    const onClose = vi.fn();
    const { getByTestId } = renderWithProvider(
      <Modal open onClose={onClose} title="Closable" testID="m">
        <span>body</span>
      </Modal>,
    );
    fireEvent.click(getByTestId('m-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onClose when the surface is pressed', () => {
    const onClose = vi.fn();
    const { getByTestId } = renderWithProvider(
      <Modal open onClose={onClose} title="Stays open" testID="m">
        <span>body</span>
      </Modal>,
    );
    fireEvent.click(getByTestId('m'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    renderWithProvider(
      <Modal open onClose={onClose} title="Esc closes" testID="m">
        <span>body</span>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
