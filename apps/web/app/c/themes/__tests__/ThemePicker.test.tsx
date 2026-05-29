import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ThemePicker } from '../ThemePicker';
import { renderWithProviders } from '../../../../test-utils/render';

describe('<ThemePicker> gating', () => {
  it('renders one option per theme', () => {
    renderWithProviders(<ThemePicker value="default" onChange={vi.fn()} tier="pro" />);
    expect(screen.getByTestId('theme-picker-option-default')).toBeInTheDocument();
    expect(screen.getByTestId('theme-picker-option-dark')).toBeInTheDocument();
    expect(screen.getByTestId('theme-picker-option-paper')).toBeInTheDocument();
    expect(screen.getByTestId('theme-picker-option-neon')).toBeInTheDocument();
    expect(screen.getByTestId('theme-picker-option-gold')).toBeInTheDocument();
  });

  it('locks every non-default theme for a free owner', () => {
    renderWithProviders(<ThemePicker value="default" onChange={vi.fn()} tier="free" />);
    expect(screen.getByTestId('theme-picker-option-default').getAttribute('data-locked')).toBe(
      'false',
    );
    for (const id of ['dark', 'paper', 'neon', 'gold']) {
      expect(screen.getByTestId(`theme-picker-option-${id}`).getAttribute('data-locked')).toBe(
        'true',
      );
    }
  });

  it('unlocks every theme for a pro owner', () => {
    renderWithProviders(<ThemePicker value="default" onChange={vi.fn()} tier="pro" />);
    for (const id of ['default', 'dark', 'paper', 'neon', 'gold']) {
      expect(screen.getByTestId(`theme-picker-option-${id}`).getAttribute('data-locked')).toBe(
        'false',
      );
    }
  });

  it('fails closed: omitted tier is treated as free', () => {
    renderWithProviders(<ThemePicker value="default" onChange={vi.fn()} />);
    expect(screen.getByTestId('theme-picker-option-gold').getAttribute('data-locked')).toBe('true');
  });

  it('marks the current value as checked', () => {
    renderWithProviders(<ThemePicker value="gold" onChange={vi.fn()} tier="pro" />);
    expect(screen.getByTestId('theme-picker-option-gold').getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(screen.getByTestId('theme-picker-option-default').getAttribute('aria-checked')).toBe(
      'false',
    );
  });

  it('calls onChange when a free owner picks the default theme', async () => {
    const onChange = vi.fn();
    renderWithProviders(<ThemePicker value="dark" onChange={onChange} tier="free" />);
    await userEvent.click(screen.getByTestId('theme-picker-option-default'));
    expect(onChange).toHaveBeenCalledWith('default');
  });

  it('does NOT call onChange when a free owner picks a locked theme', async () => {
    const onChange = vi.fn();
    renderWithProviders(<ThemePicker value="default" onChange={onChange} tier="free" />);
    await userEvent.click(screen.getByTestId('theme-picker-option-gold'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows the upgrade prompt after a free owner taps a locked theme', async () => {
    renderWithProviders(<ThemePicker value="default" onChange={vi.fn()} tier="free" />);
    expect(screen.queryByTestId('theme-upgrade-prompt')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('theme-picker-option-neon'));
    expect(screen.getByTestId('theme-upgrade-prompt')).toBeInTheDocument();
  });

  it('lets a pro owner pick a non-default theme', async () => {
    const onChange = vi.fn();
    renderWithProviders(<ThemePicker value="default" onChange={onChange} tier="pro" />);
    await userEvent.click(screen.getByTestId('theme-picker-option-gold'));
    expect(onChange).toHaveBeenCalledWith('gold');
    expect(screen.queryByTestId('theme-upgrade-prompt')).not.toBeInTheDocument();
  });

  it('never shows the upgrade prompt to a pro owner', async () => {
    renderWithProviders(<ThemePicker value="default" onChange={vi.fn()} tier="pro" />);
    await userEvent.click(screen.getByTestId('theme-picker-option-neon'));
    expect(screen.queryByTestId('theme-upgrade-prompt')).not.toBeInTheDocument();
  });

  it('does nothing when disabled', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <ThemePicker value="default" onChange={onChange} tier="pro" disabled />,
    );
    await userEvent.click(screen.getByTestId('theme-picker-option-gold'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
