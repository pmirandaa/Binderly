// Smoke render every placeholder screen the shell ships. Feature
// tasks replace these screens; the test exists so the shell PR
// catches a broken `@binderly/ui` import or a missing token before
// it's a feature-task problem.
//
// `ScannerScreen` was replaced by `src/screens/scan/ScanScreen` in
// T-SC-CAMERA. The new screen has its own dedicated tests under
// `src/screens/scan/ScanScreen.test.tsx`; it's no longer a
// placeholder so it does not belong in this smoke matrix.

import { describe, expect, it } from 'vitest';

import { BrowseScreen } from './BrowseScreen';
import { CollectionScreen } from './CollectionScreen';
import { GradingScreen } from './GradingScreen';
import { NotFoundScreen } from './NotFoundScreen';
import { PlaceholderScreen } from './PlaceholderScreen';
import { ProfileScreen } from './ProfileScreen';
import { renderWithProvider } from '../test-utils/render';

describe('placeholder screens', () => {
  it.each([
    { name: 'BrowseScreen', Comp: BrowseScreen, owner: 'T-M-BROWSE' },
    { name: 'CollectionScreen', Comp: CollectionScreen, owner: 'T-M-COLLECTION' },
    { name: 'GradingScreen', Comp: GradingScreen, owner: 'T-GR-CAPTURE-FLOW' },
    { name: 'ProfileScreen', Comp: ProfileScreen, owner: 'T-M-AUTH' },
  ])('renders $name with the owning task footnote', ({ Comp, owner }) => {
    const result = renderWithProvider(<Comp />);
    expect(result.container.textContent).toContain(`Owned by ${owner}`);
  });
});

describe('<NotFoundScreen>', () => {
  it('renders the page-not-found copy', () => {
    const result = renderWithProvider(<NotFoundScreen />);
    expect(result.container.textContent).toMatch(/Page not found/);
  });

  it('renders a Go home button', () => {
    const result = renderWithProvider(<NotFoundScreen />);
    expect(result.getByText('Go home')).toBeTruthy();
  });
});

describe('<PlaceholderScreen>', () => {
  it('renders title, description, and owner footnote', () => {
    const result = renderWithProvider(
      <PlaceholderScreen
        title="Browse"
        ownerTask="T-M-BROWSE"
        description="Sets and cards land here."
      />,
    );
    expect(result.container.textContent).toContain('Browse');
    expect(result.container.textContent).toContain('Sets and cards land here.');
    expect(result.container.textContent).toContain('Owned by T-M-BROWSE');
  });

  it('renders without a description when none is provided', () => {
    const result = renderWithProvider(<PlaceholderScreen title="Settings" ownerTask="T-M-AUTH" />);
    expect(result.container.textContent).toContain('Settings');
    expect(result.container.textContent).toContain('Owned by T-M-AUTH');
  });
});
