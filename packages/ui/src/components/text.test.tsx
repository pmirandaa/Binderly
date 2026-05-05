import { describe, expect, it } from 'vitest';

import { TEXT_VARIANT_FONT_SIZE, TEXT_VARIANT_NAMES, Text } from './text.js';
import { renderWithProvider } from '../test-utils/render.js';
import { TEXT_VARIANTS, type TextVariant } from '../tokens/typography.js';

describe('<Text>', () => {
  it('renders children', () => {
    const { getByText } = renderWithProvider(<Text>hello world</Text>);
    expect(getByText('hello world')).toBeInTheDocument();
  });

  it('exposes the same variant inventory as the typography tokens', () => {
    expect([...TEXT_VARIANT_NAMES].sort()).toEqual([...TEXT_VARIANTS].sort());
  });

  it.each(TEXT_VARIANTS)('renders variant "%s" without throwing', (variant) => {
    const { getByText } = renderWithProvider(<Text variant={variant}>variant-{variant}</Text>);
    expect(getByText(`variant-${variant}`)).toBeInTheDocument();
  });

  it.each(TEXT_VARIANTS)(
    'variant "%s" exposes a documented font-size in TEXT_VARIANT_FONT_SIZE',
    (variant) => {
      const value = TEXT_VARIANT_FONT_SIZE[variant as TextVariant];
      expect(typeof value).toBe('number');
      expect(value).toBeGreaterThan(0);
    },
  );

  it('display variant is larger than body variant (font-size)', () => {
    expect(TEXT_VARIANT_FONT_SIZE.display).toBeGreaterThan(TEXT_VARIANT_FONT_SIZE.body);
  });

  it('caption variant is smaller than body variant (font-size)', () => {
    expect(TEXT_VARIANT_FONT_SIZE.caption).toBeLessThan(TEXT_VARIANT_FONT_SIZE.body);
  });

  it('forwards `aria-label`', () => {
    const { getByLabelText } = renderWithProvider(
      <Text aria-label="hidden semantic label">visible</Text>,
    );
    expect(getByLabelText('hidden semantic label')).toBeInTheDocument();
  });

  it('renders distinct text-content for each variant', () => {
    const items = TEXT_VARIANTS.map((variant) => (
      <Text key={variant} variant={variant} testID={`text-${variant}`}>
        {variant}
      </Text>
    ));
    const { getAllByText } = renderWithProvider(<>{items}</>);
    for (const variant of TEXT_VARIANTS) {
      expect(getAllByText(variant).length).toBeGreaterThanOrEqual(1);
    }
  });
});
