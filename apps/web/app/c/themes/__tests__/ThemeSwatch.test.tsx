import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ThemeSwatch } from '../ThemeSwatch';
import { THEMES } from '../registry';
import { renderWithProviders } from '../../../../test-utils/render';

describe('<ThemeSwatch>', () => {
  it('renders a swatch keyed by theme id', () => {
    renderWithProviders(<ThemeSwatch theme={THEMES.paper} />);
    expect(screen.getByTestId('theme-swatch-paper')).toBeInTheDocument();
  });

  it('is decorative (aria-hidden) so the radio label is the a11y surface', () => {
    renderWithProviders(<ThemeSwatch theme={THEMES.default} />);
    expect(screen.getByTestId('theme-swatch-default').getAttribute('aria-hidden')).toBe('true');
  });

  it('renders one swatch per theme without throwing', () => {
    renderWithProviders(
      <>
        <ThemeSwatch theme={THEMES.default} />
        <ThemeSwatch theme={THEMES.dark} />
        <ThemeSwatch theme={THEMES.paper} />
        <ThemeSwatch theme={THEMES.neon} />
        <ThemeSwatch theme={THEMES.gold} />
      </>,
    );
    expect(screen.getByTestId('theme-swatch-gold')).toBeInTheDocument();
  });
});
