import { describe, expect, it } from 'vitest';

import { CARD_VARIANTS, Card } from './card.js';
import { renderWithProvider } from '../test-utils/render.js';

describe('<Card>', () => {
  it('renders without throwing', () => {
    const { getByTestId } = renderWithProvider(
      <Card testID="card">
        <span>contents</span>
      </Card>,
    );
    expect(getByTestId('card')).toBeInTheDocument();
  });

  it('declares variants surface / elevated / outlined', () => {
    expect([...CARD_VARIANTS]).toEqual(['surface', 'elevated', 'outlined']);
  });

  it.each(CARD_VARIANTS)('renders variant "%s"', (variant) => {
    const { getByTestId } = renderWithProvider(
      <Card testID={`card-${variant}`} variant={variant}>
        <span>x</span>
      </Card>,
    );
    expect(getByTestId(`card-${variant}`)).toBeInTheDocument();
  });

  it('renders the children of the card', () => {
    const { getByText } = renderWithProvider(
      <Card>
        <span>Body of card</span>
      </Card>,
    );
    expect(getByText('Body of card')).toBeInTheDocument();
  });

  it('outlined variant produces non-zero border in the rendered style', () => {
    const { getByTestId } = renderWithProvider(
      <Card testID="card-outlined" variant="outlined">
        <span>x</span>
      </Card>,
    );
    const node = getByTestId('card-outlined');
    const styles = window.getComputedStyle(node);
    // Tamagui can either inline the border via class names or via the
    // style attribute; either is acceptable evidence the variant fired.
    const evidence =
      (styles.borderWidth !== '0px' && styles.borderWidth !== '') ||
      (styles.borderTopWidth !== '0px' && styles.borderTopWidth !== '') ||
      node.className.includes('borderWidth') ||
      // Fall back to checking the inline style attribute.
      (node.getAttribute('style') ?? '').includes('border');
    expect(evidence).toBe(true);
  });
});
