import { describe, expect, it } from 'vitest';

import { THEME_NAMES, UIProvider } from './ui-provider.js';
import { renderWithProvider } from '../test-utils/render.js';

describe('<UIProvider>', () => {
  it('renders children without throwing', () => {
    const { getByTestId } = renderWithProvider(<div data-testid="child">hello</div>);
    expect(getByTestId('child')).toBeInTheDocument();
  });

  it('accepts the default light theme', () => {
    const { getByTestId } = renderWithProvider(<div data-testid="child">light</div>, {
      theme: 'light',
    });
    expect(getByTestId('child')).toBeInTheDocument();
  });

  it('accepts the dark theme', () => {
    const { getByTestId } = renderWithProvider(<div data-testid="child">dark</div>, {
      theme: 'dark',
    });
    expect(getByTestId('child')).toBeInTheDocument();
  });

  it('THEME_NAMES is the documented union', () => {
    expect([...THEME_NAMES]).toEqual(['light', 'dark']);
  });

  it('UIProvider is a function component', () => {
    expect(typeof UIProvider).toBe('function');
  });

  it('lets two providers nest without crashing (idempotent)', () => {
    const { getByTestId } = renderWithProvider(
      <UIProvider defaultTheme="dark">
        <div data-testid="nested">nested</div>
      </UIProvider>,
    );
    expect(getByTestId('nested')).toBeInTheDocument();
  });
});
