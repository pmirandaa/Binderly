import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ShareableThemeProvider, useShareableTheme } from './ShareableThemeProvider';
import { DEFAULT_THEME, THEMES } from './registry';

describe('<ShareableThemeProvider>', () => {
  it('renders a themed root carrying theme metadata data-attributes', () => {
    render(
      <ShareableThemeProvider theme={THEMES.gold}>
        <span data-testid="child">hi</span>
      </ShareableThemeProvider>,
    );
    const child = screen.getByTestId('child');
    const root = child.parentElement as HTMLElement;
    expect(root.getAttribute('data-share-theme')).toBe('gold');
    expect(root.getAttribute('data-card-frame')).toBe(THEMES.gold.cardFrame);
    expect(root.getAttribute('data-header-treatment')).toBe(THEMES.gold.header);
  });

  it('renders its children', () => {
    render(
      <ShareableThemeProvider theme={DEFAULT_THEME}>
        <span data-testid="child">content</span>
      </ShareableThemeProvider>,
    );
    expect(screen.getByTestId('child')).toHaveTextContent('content');
  });

  it('paints the theme background colour on the root', () => {
    render(
      <ShareableThemeProvider theme={THEMES.dark}>
        <span data-testid="child">x</span>
      </ShareableThemeProvider>,
    );
    const root = screen.getByTestId('child').parentElement as HTMLElement;
    expect(root.style.backgroundColor).not.toBe('');
  });

  it('renders the accent band for a `band`-header theme', () => {
    render(
      <ShareableThemeProvider theme={THEMES.dark}>
        <span>x</span>
      </ShareableThemeProvider>,
    );
    expect(screen.getByTestId('share-theme-band')).toBeInTheDocument();
  });

  it('omits the accent band for a `plain`-header theme', () => {
    render(
      <ShareableThemeProvider theme={DEFAULT_THEME}>
        <span>x</span>
      </ShareableThemeProvider>,
    );
    expect(screen.queryByTestId('share-theme-band')).toBeNull();
  });

  it('exposes the active theme via useShareableTheme', () => {
    function Probe(): React.ReactNode {
      const theme = useShareableTheme();
      return <span data-testid="probe">{theme.id}</span>;
    }
    render(
      <ShareableThemeProvider theme={THEMES.neon}>
        <Probe />
      </ShareableThemeProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('neon');
  });

  it('throws when useShareableTheme is used outside a provider', () => {
    function Orphan(): React.ReactNode {
      useShareableTheme();
      return null;
    }
    expect(() => render(<Orphan />)).toThrow(/ShareableThemeProvider/);
  });
});
