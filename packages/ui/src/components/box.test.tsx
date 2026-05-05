import { describe, expect, it } from 'vitest';

import { Box } from './box.js';
import { renderWithProvider } from '../test-utils/render.js';

describe('<Box>', () => {
  it('renders without throwing', () => {
    const { getByTestId } = renderWithProvider(<Box testID="box" />);
    expect(getByTestId('box')).toBeInTheDocument();
  });

  it('renders children', () => {
    const { getByText } = renderWithProvider(
      <Box>
        <span>contents</span>
      </Box>,
    );
    expect(getByText('contents')).toBeInTheDocument();
  });

  it('forwards data-testid', () => {
    const { getByTestId } = renderWithProvider(<Box testID="custom" />);
    expect(getByTestId('custom')).toBeInTheDocument();
  });
});
