import { describe, expect, it } from 'vitest';

import { Stack, XStack, YStack } from './stack.js';
import { renderWithProvider } from '../test-utils/render.js';

describe('<Stack>', () => {
  it('renders children', () => {
    const { getByText } = renderWithProvider(
      <Stack>
        <span>plain</span>
      </Stack>,
    );
    expect(getByText('plain')).toBeInTheDocument();
  });
});

describe('<XStack>', () => {
  it('renders without throwing', () => {
    const { getByTestId } = renderWithProvider(
      <XStack testID="xstack">
        <span>a</span>
        <span>b</span>
      </XStack>,
    );
    expect(getByTestId('xstack')).toBeInTheDocument();
  });

  it('arranges children horizontally (flex-direction: row)', () => {
    const { getByTestId } = renderWithProvider(<XStack testID="xstack" />);
    const node = getByTestId('xstack');
    const styles = window.getComputedStyle(node);
    expect(styles.flexDirection === 'row' || node.className.includes('row')).toBe(true);
  });
});

describe('<YStack>', () => {
  it('renders without throwing', () => {
    const { getByTestId } = renderWithProvider(
      <YStack testID="ystack">
        <span>a</span>
      </YStack>,
    );
    expect(getByTestId('ystack')).toBeInTheDocument();
  });

  it('arranges children vertically (flex-direction: column)', () => {
    const { getByTestId } = renderWithProvider(<YStack testID="ystack" />);
    const node = getByTestId('ystack');
    const styles = window.getComputedStyle(node);
    expect(styles.flexDirection === 'column' || node.className.includes('column')).toBe(true);
  });

  it('XStack and YStack are distinct components', () => {
    expect(XStack).not.toBe(YStack);
  });
});
