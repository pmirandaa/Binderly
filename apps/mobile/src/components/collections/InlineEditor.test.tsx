import { act, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InlineEditor } from './InlineEditor';
import { renderWithProvider } from '../../test-utils/render';

describe('<InlineEditor>', () => {
  it('renders the value when not editing', () => {
    const result = renderWithProvider(
      <InlineEditor label="Name" value="Charizard" onSave={vi.fn()} />,
    );
    expect(result.getByTestId('inline-editor-display').textContent).toContain('Charizard');
  });

  it('renders a placeholder when value is empty', () => {
    const result = renderWithProvider(
      <InlineEditor
        label="Name"
        value=""
        placeholder="Add a description"
        onSave={vi.fn()}
      />,
    );
    expect(result.getByTestId('inline-editor-display').textContent).toContain(
      'Add a description',
    );
  });

  it('switches to edit mode when display is tapped', () => {
    const result = renderWithProvider(
      <InlineEditor label="Name" value="Charizard" onSave={vi.fn()} />,
    );
    fireEvent.click(result.getByTestId('inline-editor-display'));
    expect(result.queryByTestId('inline-editor-input')).not.toBeNull();
    expect(result.queryByTestId('inline-editor-save')).not.toBeNull();
  });

  it('fires onSave with the trimmed next value', () => {
    const onSave = vi.fn();
    const result = renderWithProvider(
      <InlineEditor label="Name" value="Charizard" onSave={onSave} />,
    );
    fireEvent.click(result.getByTestId('inline-editor-display'));
    const input = result.container.querySelector('input');
    if (input === null) throw new Error('expected input element');
    act(() => {
      fireEvent.change(input, { target: { value: '  Blastoise  ' } });
    });
    fireEvent.click(result.getByTestId('inline-editor-save'));
    expect(onSave).toHaveBeenCalledWith('Blastoise');
  });

  it('does NOT fire onSave when the value is unchanged', () => {
    const onSave = vi.fn();
    const result = renderWithProvider(
      <InlineEditor label="Name" value="Charizard" onSave={onSave} />,
    );
    fireEvent.click(result.getByTestId('inline-editor-display'));
    fireEvent.click(result.getByTestId('inline-editor-save'));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('does NOT fire onSave when the value becomes empty', () => {
    const onSave = vi.fn();
    const result = renderWithProvider(
      <InlineEditor label="Name" value="Charizard" onSave={onSave} />,
    );
    fireEvent.click(result.getByTestId('inline-editor-display'));
    const input = result.container.querySelector('input');
    if (input === null) throw new Error('expected input');
    act(() => {
      fireEvent.change(input, { target: { value: '   ' } });
    });
    fireEvent.click(result.getByTestId('inline-editor-save'));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('reverts the draft on cancel', () => {
    const onSave = vi.fn();
    const result = renderWithProvider(
      <InlineEditor label="Name" value="Charizard" onSave={onSave} />,
    );
    fireEvent.click(result.getByTestId('inline-editor-display'));
    const input = result.container.querySelector('input');
    if (input === null) throw new Error('expected input');
    act(() => {
      fireEvent.change(input, { target: { value: 'Mewtwo' } });
    });
    fireEvent.click(result.getByTestId('inline-editor-cancel'));
    expect(onSave).not.toHaveBeenCalled();
    expect(result.queryByTestId('inline-editor-input')).toBeNull();
    expect(result.getByTestId('inline-editor-display').textContent).toContain('Charizard');
  });

  it('does not enter edit mode when disabled', () => {
    const result = renderWithProvider(
      <InlineEditor label="Name" value="Charizard" onSave={vi.fn()} disabled />,
    );
    fireEvent.click(result.getByTestId('inline-editor-display'));
    expect(result.queryByTestId('inline-editor-input')).toBeNull();
  });
});
