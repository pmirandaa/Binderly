import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { BrowseView } from './BrowseView';
import { SAMPLE_SETS, createFakeBrowseApi } from '../../lib/browse/fixtures';
import { renderWithProviders } from '../../test-utils/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/browse',
  useSearchParams: () => new URLSearchParams(),
}));

function renderBrowse(api: ReturnType<typeof createFakeBrowseApi>): void {
  // Disable the search debounce in tests so user input + filter
  // assertions are deterministic without timer juggling.
  renderWithProviders(<BrowseView api={api} searchDebounceMs={0} />);
}

describe('BrowseView — list rendering', () => {
  it('shows a loading state while sets resolve', async () => {
    let resolve: ((sets: typeof SAMPLE_SETS) => void) | null = null;
    const api = createFakeBrowseApi({ sets: SAMPLE_SETS });
    api.listAllSets.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r as (sets: typeof SAMPLE_SETS) => void;
        }),
    );
    renderBrowse(api);
    expect(screen.getByText(/loading sets/i)).toBeInTheDocument();
    await act(async () => {
      resolve?.(SAMPLE_SETS);
    });
    await waitFor(() => {
      expect(screen.getByTestId('browse-grid')).toBeInTheDocument();
    });
  });

  it('renders a card per set returned by the api-client', async () => {
    const api = createFakeBrowseApi({ sets: SAMPLE_SETS });
    renderBrowse(api);
    await waitFor(() => {
      expect(screen.getByTestId('browse-grid')).toBeInTheDocument();
    });
    expect(screen.getAllByTestId('set-card')).toHaveLength(SAMPLE_SETS.length);
  });

  it('orders sets by release_date descending — the Pablo regression', async () => {
    const api = createFakeBrowseApi({ sets: SAMPLE_SETS });
    renderBrowse(api);
    await waitFor(() => {
      expect(screen.getByTestId('browse-grid')).toBeInTheDocument();
    });
    const names = screen.getAllByTestId('set-card-name').map((n) => n.textContent);
    expect(names).toEqual([
      'Temporal Forces',
      'Vstar Universe',
      'Astral Radiance',
      'Base Set',
    ]);
  });

  it('routes set cards to /sets/[slug] using the canonicalKey', async () => {
    const api = createFakeBrowseApi({ sets: SAMPLE_SETS });
    renderBrowse(api);
    await waitFor(() => {
      expect(screen.getByTestId('browse-grid')).toBeInTheDocument();
    });
    const links = screen.getAllByTestId('set-card-link');
    const hrefs = links.map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/sets/en-sv5');
    expect(hrefs).toContain('/sets/jp-svv');
  });

  it('renders the headline + helper copy', async () => {
    const api = createFakeBrowseApi({ sets: SAMPLE_SETS });
    renderBrowse(api);
    await waitFor(() => {
      expect(screen.getByText('Browse sets')).toBeInTheDocument();
    });
    expect(screen.getByText(/newest first/i)).toBeInTheDocument();
  });

  it('shows the result count out of the total catalog', async () => {
    const api = createFakeBrowseApi({ sets: SAMPLE_SETS });
    renderBrowse(api);
    await waitFor(() => {
      expect(screen.getByTestId('browse-result-count')).toBeInTheDocument();
    });
    expect(screen.getByTestId('browse-result-count')).toHaveTextContent('4 of 4 sets');
  });
});

describe('BrowseView — language filter', () => {
  it('narrows the list to English sets when EN is selected', async () => {
    const api = createFakeBrowseApi({ sets: SAMPLE_SETS });
    renderBrowse(api);
    await waitFor(() => {
      expect(screen.getByTestId('browse-grid')).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('browse-language-en'));
    });
    const names = screen.getAllByTestId('set-card-name').map((n) => n.textContent);
    expect(names).toEqual(['Temporal Forces', 'Astral Radiance', 'Base Set']);
  });

  it('narrows the list to Japanese sets when JP is selected', async () => {
    const api = createFakeBrowseApi({ sets: SAMPLE_SETS });
    renderBrowse(api);
    await waitFor(() => {
      expect(screen.getByTestId('browse-grid')).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('browse-language-jp'));
    });
    const names = screen.getAllByTestId('set-card-name').map((n) => n.textContent);
    expect(names).toEqual(['Vstar Universe']);
  });

  it('returns to all sets when the All radio is reselected', async () => {
    const api = createFakeBrowseApi({ sets: SAMPLE_SETS });
    renderBrowse(api);
    await waitFor(() => {
      expect(screen.getByTestId('browse-grid')).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('browse-language-jp'));
    });
    expect(screen.getAllByTestId('set-card')).toHaveLength(1);
    await act(async () => {
      fireEvent.click(screen.getByTestId('browse-language-all'));
    });
    expect(screen.getAllByTestId('set-card')).toHaveLength(SAMPLE_SETS.length);
  });
});

describe('BrowseView — search', () => {
  it('debounces and narrows by case-insensitive substring match', async () => {
    const api = createFakeBrowseApi({ sets: SAMPLE_SETS });
    renderBrowse(api);
    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByTestId('browse-grid')).toBeInTheDocument();
    });
    const input = screen.getByTestId('browse-search-input') as HTMLInputElement;
    await user.type(input, 'temporal');
    await waitFor(() => {
      expect(screen.getAllByTestId('set-card')).toHaveLength(1);
    });
    expect(screen.getByTestId('set-card-name')).toHaveTextContent('Temporal Forces');
  });

  it('falls back to all results when the search box is cleared', async () => {
    const api = createFakeBrowseApi({ sets: SAMPLE_SETS });
    renderBrowse(api);
    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByTestId('browse-grid')).toBeInTheDocument();
    });
    const input = screen.getByTestId('browse-search-input') as HTMLInputElement;
    await user.type(input, 'temporal');
    await waitFor(() => {
      expect(screen.getAllByTestId('set-card')).toHaveLength(1);
    });
    await user.clear(input);
    await waitFor(() => {
      expect(screen.getAllByTestId('set-card')).toHaveLength(SAMPLE_SETS.length);
    });
  });
});

describe('BrowseView — series filter', () => {
  it('filters by series when a chip is toggled on', async () => {
    const api = createFakeBrowseApi({ sets: SAMPLE_SETS });
    renderBrowse(api);
    await waitFor(() => {
      expect(screen.getByTestId('browse-grid')).toBeInTheDocument();
    });
    const filter = screen.getByTestId('browse-series-filter');
    const chip = within(filter).getByText('Original');
    await act(async () => {
      fireEvent.click(chip);
    });
    expect(screen.getAllByTestId('set-card')).toHaveLength(1);
    expect(screen.getByTestId('set-card-name')).toHaveTextContent('Base Set');
  });
});

describe('BrowseView — empty + error states', () => {
  it('shows the empty state when the filter combination yields nothing', async () => {
    const api = createFakeBrowseApi({ sets: SAMPLE_SETS });
    renderBrowse(api);
    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByTestId('browse-grid')).toBeInTheDocument();
    });
    const input = screen.getByTestId('browse-search-input') as HTMLInputElement;
    await user.type(input, 'no-such-set');
    await waitFor(() => {
      expect(screen.getByTestId('browse-empty')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('browse-grid')).toBeNull();
  });

  it('renders the error state when the api-client throws', async () => {
    const api = createFakeBrowseApi({ rejectAll: new Error('backend down') });
    renderBrowse(api);
    await waitFor(() => {
      expect(screen.getByTestId('browse-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('browse-error')).toHaveTextContent('backend down');
  });

  it('clears all filters when the reset button is pressed', async () => {
    const api = createFakeBrowseApi({ sets: SAMPLE_SETS });
    renderBrowse(api);
    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByTestId('browse-grid')).toBeInTheDocument();
    });
    await user.type(
      screen.getByTestId('browse-search-input') as HTMLInputElement,
      'temporal',
    );
    await waitFor(() => {
      expect(screen.getAllByTestId('set-card')).toHaveLength(1);
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('browse-clear-filters'));
    });
    await waitFor(() => {
      expect(screen.getAllByTestId('set-card')).toHaveLength(SAMPLE_SETS.length);
    });
    expect((screen.getByTestId('browse-search-input') as HTMLInputElement).value).toBe('');
  });
});
