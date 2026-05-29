import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ShareableThemeProvider } from '../ShareableThemeProvider';
import { THEMES } from '../registry';
import { renderWithProviders } from '../../../../test-utils/render';

describe('<ShareableThemeProvider>', () => {
  it('renders its children', () => {
    renderWithProviders(
      <ShareableThemeProvider theme={THEMES.default}>
        <span data-testid="child">hello</span>
      </ShareableThemeProvider>,
    );
    expect(screen.getByTestId('child')).toHaveTextContent('hello');
  });

  it('exposes the resolved theme id on the frame', () => {
    renderWithProviders(
      <ShareableThemeProvider theme={THEMES.gold}>
        <span>x</span>
      </ShareableThemeProvider>,
    );
    const frame = screen.getByTestId('shareable-theme-frame');
    expect(frame.getAttribute('data-theme')).toBe('gold');
  });

  it('applies the theme font-family + base text colour to the frame', () => {
    renderWithProviders(
      <ShareableThemeProvider theme={THEMES.neon}>
        <span>x</span>
      </ShareableThemeProvider>,
    );
    const frame = screen.getByTestId('shareable-theme-frame');
    expect(frame.style.fontFamily).toContain('monospace');
    expect(frame.style.color.length).toBeGreaterThan(0);
  });
});
