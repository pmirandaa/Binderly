import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiNotFoundError } from '@binderly/api-client';

import { CardView } from './CardView';
import {
  createFakeBrowseApi,
  makeCard,
  makePrintingWithContext,
  makeSet,
} from '../../lib/browse/fixtures';
import { renderWithProviders } from '../../test-utils/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/cards/abc',
  useSearchParams: () => new URLSearchParams(),
}));

const PRINTING_ID = 'pr-1';

function makeStandardPrintingFixture(): ReturnType<typeof makePrintingWithContext> {
  return makePrintingWithContext({
    id: PRINTING_ID,
    variantClass: 'HOLO',
    imageLargeUrl: 'https://images.binderly.app/printings/charizard-large.webp',
    imageSmallUrl: 'https://images.binderly.app/printings/charizard-small.webp',
    card: makeCard({
      id: 'card-charizard',
      name: 'Charizard',
      number: '4',
      illustrator: 'Mitsuhiro Arita',
      rarity: 'HOLO_RARE',
      language: 'en',
    }),
    set: makeSet({
      id: 'set-base',
      name: 'Base Set',
      releaseDate: '1999-01-09',
      language: 'en',
    }),
  });
}

describe('CardView — success path', () => {
  it('renders the hero image and metadata', async () => {
    const fixture = makeStandardPrintingFixture();
    const api = createFakeBrowseApi({ printingsById: { [PRINTING_ID]: fixture } });
    renderWithProviders(<CardView api={api} printingId={PRINTING_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId('card-meta-name')).toBeInTheDocument();
    });
    expect(screen.getByTestId('card-meta-name')).toHaveTextContent('Charizard');
    expect(screen.getByTestId('card-hero-image').getAttribute('src')).toContain(
      'charizard-large.webp',
    );
  });

  it('renders meta rows: set, number, variant, rarity, illustrator, language, release', async () => {
    const fixture = makeStandardPrintingFixture();
    const api = createFakeBrowseApi({ printingsById: { [PRINTING_ID]: fixture } });
    renderWithProviders(<CardView api={api} printingId={PRINTING_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId('card-meta-grid')).toBeInTheDocument();
    });
    expect(screen.getByTestId('card-meta-row-set')).toHaveTextContent('Base Set');
    expect(screen.getByTestId('card-meta-row-number')).toHaveTextContent('4');
    expect(screen.getByTestId('card-meta-row-variant')).toHaveTextContent('holo');
    expect(screen.getByTestId('card-meta-row-rarity')).toHaveTextContent('Holo Rare');
    expect(screen.getByTestId('card-meta-row-illustrator')).toHaveTextContent(
      'Mitsuhiro Arita',
    );
    expect(screen.getByTestId('card-meta-row-language')).toHaveTextContent('English');
    expect(screen.getByTestId('card-meta-row-released').textContent ?? '').toMatch(/1999/);
  });

  it('renders the prices placeholder section', async () => {
    const fixture = makeStandardPrintingFixture();
    const api = createFakeBrowseApi({ printingsById: { [PRINTING_ID]: fixture } });
    renderWithProviders(<CardView api={api} printingId={PRINTING_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId('card-prices-placeholder')).toBeInTheDocument();
    });
    expect(screen.getByTestId('card-prices-placeholder')).toHaveTextContent('Prices');
  });

  it('renders a disabled "Add to collection" button with the sign-in tooltip', async () => {
    const fixture = makeStandardPrintingFixture();
    const api = createFakeBrowseApi({ printingsById: { [PRINTING_ID]: fixture } });
    renderWithProviders(<CardView api={api} printingId={PRINTING_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId('card-add-button')).toBeInTheDocument();
    });
    const tooltipWrap = screen.getByTestId('card-add-tooltip');
    expect(tooltipWrap.getAttribute('title')).toBe('Sign in to track your collection');
    const button = screen.getByTestId('card-add-button');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-label')).toBe('Sign in to track your collection');
  });

  it('routes the back-link to the parent set page', async () => {
    const fixture = makeStandardPrintingFixture();
    const api = createFakeBrowseApi({ printingsById: { [PRINTING_ID]: fixture } });
    renderWithProviders(<CardView api={api} printingId={PRINTING_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId('card-back-link')).toBeInTheDocument();
    });
    expect(screen.getByTestId('card-back-link').getAttribute('href')).toBe('/sets/set-base');
  });

  it('falls back to the small image when the large image is null', async () => {
    const fixture = makeStandardPrintingFixture();
    const fallbackFixture = { ...fixture, imageLargeUrl: null };
    const api = createFakeBrowseApi({
      printingsById: { [PRINTING_ID]: fallbackFixture },
    });
    renderWithProviders(<CardView api={api} printingId={PRINTING_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId('card-hero-image')).toBeInTheDocument();
    });
    expect(screen.getByTestId('card-hero-image').getAttribute('src')).toContain(
      'charizard-small.webp',
    );
  });

  it('renders a fallback placeholder when both image urls are null', async () => {
    const fixture = makeStandardPrintingFixture();
    const noImage = { ...fixture, imageLargeUrl: null, imageSmallUrl: null };
    const api = createFakeBrowseApi({ printingsById: { [PRINTING_ID]: noImage } });
    renderWithProviders(<CardView api={api} printingId={PRINTING_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId('card-hero-fallback')).toBeInTheDocument();
    });
  });
});

describe('CardView — 404 + error', () => {
  it('invokes onNotFound on ApiNotFoundError', async () => {
    const onNotFound = vi.fn();
    const api = createFakeBrowseApi();
    api.getPrintingDetail = vi.fn().mockRejectedValue(
      new ApiNotFoundError('printing not found'),
    );
    renderWithProviders(
      <CardView api={api} printingId="missing" onNotFound={onNotFound} />,
    );
    await waitFor(() => {
      expect(onNotFound).toHaveBeenCalledTimes(1);
    });
  });

  it('renders an inline error when no onNotFound is provided', async () => {
    const api = createFakeBrowseApi();
    api.getPrintingDetail = vi.fn().mockRejectedValue(
      new ApiNotFoundError('printing not found'),
    );
    renderWithProviders(<CardView api={api} printingId="missing" />);
    await waitFor(() => {
      expect(screen.getByTestId('card-error')).toBeInTheDocument();
    });
  });

  it('renders an error state when the api-client throws a generic Error', async () => {
    const api = createFakeBrowseApi();
    api.getPrintingDetail = vi.fn().mockRejectedValue(new Error('boom'));
    renderWithProviders(<CardView api={api} printingId={PRINTING_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId('card-error')).toHaveTextContent('boom');
    });
  });
});
