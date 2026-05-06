import { describe, expect, it } from 'vitest';

import { PageLoading } from './PageLoading';
import { renderWithProvider } from '../../test-utils/render';

describe('<PageLoading>', () => {
  it('renders without throwing', () => {
    const result = renderWithProvider(<PageLoading />);
    expect(result.container.firstChild).toBeTruthy();
  });

  it('renders the supplied message', () => {
    const result = renderWithProvider(<PageLoading message="Hydrating session" />);
    expect(result.container.textContent).toContain('Hydrating session');
  });

  it('does not render a message when none is provided', () => {
    const result = renderWithProvider(<PageLoading />);
    // No body/caption text should be rendered.
    const text = result.container.textContent ?? '';
    expect(text.length).toBe(0);
  });
});
