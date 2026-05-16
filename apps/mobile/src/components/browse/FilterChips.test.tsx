import { act, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Chip, FilterChips } from './FilterChips';
import { UNKNOWN_SERIES } from '../../lib/browse';
import { renderWithProvider } from '../../test-utils/render';

describe('<Chip>', () => {
  it('invokes onPress when tapped', async () => {
    const onPress = vi.fn();
    const result = renderWithProvider(
      <Chip label="EN" selected={false} onPress={onPress} testID="chip-en" />,
    );
    await act(async () => {
      fireEvent.click(result.getByTestId('chip-en'));
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('reflects `selected` via aria-pressed', () => {
    const result = renderWithProvider(
      <Chip label="JP" selected onPress={() => undefined} testID="chip-jp" />,
    );
    expect(result.getByTestId('chip-jp').getAttribute('aria-pressed')).toBe('true');
  });

  it('marks unselected chips as aria-pressed=false (or absent)', () => {
    const result = renderWithProvider(
      <Chip label="EN" selected={false} onPress={() => undefined} testID="chip-en" />,
    );
    const pressed = result.getByTestId('chip-en').getAttribute('aria-pressed');
    expect(pressed === null || pressed === 'false').toBe(true);
  });
});

describe('<FilterChips>', () => {
  it('renders the three language chips', () => {
    const result = renderWithProvider(
      <FilterChips
        language="ALL"
        onLanguageChange={() => undefined}
        seriesOptions={[]}
        selectedSeries={new Set()}
        onToggleSeries={() => undefined}
      />,
    );
    expect(result.getByTestId('browse-language-all')).toBeDefined();
    expect(result.getByTestId('browse-language-en')).toBeDefined();
    expect(result.getByTestId('browse-language-jp')).toBeDefined();
  });

  it('calls onLanguageChange with the tapped chip token', async () => {
    const onLanguageChange = vi.fn();
    const result = renderWithProvider(
      <FilterChips
        language="ALL"
        onLanguageChange={onLanguageChange}
        seriesOptions={[]}
        selectedSeries={new Set()}
        onToggleSeries={() => undefined}
      />,
    );
    await act(async () => {
      fireEvent.click(result.getByTestId('browse-language-jp'));
    });
    expect(onLanguageChange).toHaveBeenCalledWith('jp');
  });

  it('renders series chips when seriesOptions is non-empty and labels UNKNOWN_SERIES as "Other"', () => {
    const result = renderWithProvider(
      <FilterChips
        language="ALL"
        onLanguageChange={() => undefined}
        seriesOptions={['Original', UNKNOWN_SERIES]}
        selectedSeries={new Set()}
        onToggleSeries={() => undefined}
      />,
    );
    expect(result.getByTestId('browse-series-chips')).toBeDefined();
    expect(result.container.textContent).toContain('Original');
    expect(result.container.textContent).toContain('Other');
  });

  it('omits the series chip row entirely when no series options are passed', () => {
    const result = renderWithProvider(
      <FilterChips
        language="ALL"
        onLanguageChange={() => undefined}
        seriesOptions={[]}
        selectedSeries={new Set()}
        onToggleSeries={() => undefined}
      />,
    );
    expect(result.queryByTestId('browse-series-chips')).toBeNull();
  });

  it('forwards series-chip taps to onToggleSeries with the original token', async () => {
    const onToggleSeries = vi.fn();
    const result = renderWithProvider(
      <FilterChips
        language="ALL"
        onLanguageChange={() => undefined}
        seriesOptions={['Sword & Shield']}
        selectedSeries={new Set()}
        onToggleSeries={onToggleSeries}
      />,
    );
    await act(async () => {
      fireEvent.click(result.getByTestId('browse-series-sword-shield'));
    });
    expect(onToggleSeries).toHaveBeenCalledWith('Sword & Shield');
  });
});
