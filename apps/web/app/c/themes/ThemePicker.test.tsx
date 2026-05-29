import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  gate: { result: { allowed: true }, isLoading: false } as GateState,
}));

vi.mock('../../../lib/gating/useGate', () => ({
  useGate: () => hoisted.gate,
  useLimitGate: () => hoisted.gate,
}));

import { ThemePicker } from './ThemePicker';
import { THEME_LIST } from './registry';
import { renderWithProviders } from '../../../test-utils/render';

import type { GateState } from '../../../lib/gating/useGate';

function setPro(): void {
  hoisted.gate = { result: { allowed: true }, isLoading: false };
}
function setFree(): void {
  hoisted.gate = {
    result: { allowed: false, reason: 'requires_pro', feature: 'shareable_themes' },
    isLoading: false,
  };
}

afterEach(() => {
  setPro();
});

describe('<ThemePicker> — gallery', () => {
  it('renders an option for every theme', () => {
    renderWithProviders(<ThemePicker value="default" onSelect={vi.fn()} testId="tp" />);
    for (const theme of THEME_LIST) {
      expect(screen.getByTestId(`tp-option-${theme.id}`)).toBeInTheDocument();
    }
  });

  it('marks the currently-selected option', () => {
    renderWithProviders(<ThemePicker value="neon" onSelect={vi.fn()} testId="tp" />);
    expect(screen.getByTestId('tp-option-neon').getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId('tp-option-default').getAttribute('data-selected')).toBe('false');
  });
});

describe('<ThemePicker> — pro owner (unlocked)', () => {
  it('does not show the free hint', () => {
    setPro();
    renderWithProviders(<ThemePicker value="default" onSelect={vi.fn()} testId="tp" />);
    expect(screen.queryByTestId('tp-free-hint')).toBeNull();
  });

  it('does not lock any option', () => {
    setPro();
    renderWithProviders(<ThemePicker value="default" onSelect={vi.fn()} testId="tp" />);
    expect(screen.getByTestId('tp-option-gold').getAttribute('data-locked')).toBe('false');
  });

  it('selects a Pro theme on click', () => {
    setPro();
    const onSelect = vi.fn();
    renderWithProviders(<ThemePicker value="default" onSelect={onSelect} testId="tp" />);
    fireEvent.click(screen.getByTestId('tp-option-gold'));
    expect(onSelect).toHaveBeenCalledWith('gold');
  });

  it('does not show an upgrade prompt when selecting a Pro theme', () => {
    setPro();
    renderWithProviders(<ThemePicker value="default" onSelect={vi.fn()} testId="tp" />);
    fireEvent.click(screen.getByTestId('tp-option-neon'));
    expect(screen.queryByTestId('tp-upgrade')).toBeNull();
  });
});

describe('<ThemePicker> — free owner (locked)', () => {
  it('shows the free hint', () => {
    setFree();
    renderWithProviders(<ThemePicker value="default" onSelect={vi.fn()} testId="tp" />);
    expect(screen.getByTestId('tp-free-hint')).toBeInTheDocument();
  });

  it('locks Pro themes but leaves default selectable', () => {
    setFree();
    renderWithProviders(<ThemePicker value="default" onSelect={vi.fn()} testId="tp" />);
    expect(screen.getByTestId('tp-option-gold').getAttribute('data-locked')).toBe('true');
    expect(screen.getByTestId('tp-option-default').getAttribute('data-locked')).toBe('false');
  });

  it('does not persist a Pro theme and shows the upgrade prompt', () => {
    setFree();
    const onSelect = vi.fn();
    renderWithProviders(<ThemePicker value="default" onSelect={onSelect} testId="tp" />);
    fireEvent.click(screen.getByTestId('tp-option-gold'));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByTestId('tp-upgrade')).toBeInTheDocument();
  });

  it('upgrade prompt CTA routes to /billing', () => {
    setFree();
    renderWithProviders(<ThemePicker value="default" onSelect={vi.fn()} testId="tp" />);
    fireEvent.click(screen.getByTestId('tp-option-gold'));
    expect(screen.getByTestId('upgrade-prompt-cta').getAttribute('href')).toBe('/billing');
  });

  it('still lets a free user pick the default theme', () => {
    setFree();
    const onSelect = vi.fn();
    renderWithProviders(<ThemePicker value="neon" onSelect={onSelect} testId="tp" />);
    fireEvent.click(screen.getByTestId('tp-option-default'));
    expect(onSelect).toHaveBeenCalledWith('default');
  });
});
