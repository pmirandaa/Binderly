import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { THEMES } from './registry';
import { ThemeThumbnail } from './ThemeThumbnail';

describe('<ThemeThumbnail>', () => {
  it('renders with a default testid derived from the theme id', () => {
    render(<ThemeThumbnail theme={THEMES.paper} />);
    expect(screen.getByTestId('theme-thumbnail-paper')).toBeInTheDocument();
  });

  it('honours a custom testid', () => {
    render(<ThemeThumbnail theme={THEMES.dark} testId="swatch-dark" />);
    expect(screen.getByTestId('swatch-dark')).toBeInTheDocument();
  });

  it('marks the selected state via data-selected', () => {
    render(<ThemeThumbnail theme={THEMES.gold} selected testId="sel" />);
    expect(screen.getByTestId('sel').getAttribute('data-selected')).toBe('true');
  });

  it('defaults data-selected to false', () => {
    render(<ThemeThumbnail theme={THEMES.gold} testId="unsel" />);
    expect(screen.getByTestId('unsel').getAttribute('data-selected')).toBe('false');
  });

  it('is decorative (aria-hidden)', () => {
    render(<ThemeThumbnail theme={THEMES.neon} testId="deco" />);
    expect(screen.getByTestId('deco').getAttribute('aria-hidden')).toBe('true');
  });
});
