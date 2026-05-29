import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ShareableTheme } from '@binderly/api-contracts';

import { ShareableView } from './ShareableView';
import {
  FIXTURE_MEMBERS,
  FIXTURE_PUBLIC_SHARE_PAYLOAD,
  createFakeShareApi,
  makePublicShareOwner,
  makePublicSharePayload,
  makeShareableDto,
} from '../../lib/share/fixtures';
import { renderWithProviders } from '../../test-utils/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/c/pablo/my-binder',
  useSearchParams: () => new URLSearchParams(),
  notFound: vi.fn(),
}));

function renderView(
  api: ReturnType<typeof createFakeShareApi>,
  overrides: { handle?: string; slug?: string; onNotFound?: () => void; now?: Date } = {},
): void {
  renderWithProviders(
    <ShareableView
      api={api}
      handle={overrides.handle ?? 'pablo'}
      slug={overrides.slug ?? 'my-binder'}
      {...(overrides.onNotFound !== undefined ? { onNotFound: overrides.onNotFound } : {})}
      {...(overrides.now !== undefined ? { now: overrides.now } : {})}
    />,
  );
}

describe('ShareableView — loading + error', () => {
  it('shows a loading state while the api call is pending', async () => {
    let resolvePayload: ((v: typeof FIXTURE_PUBLIC_SHARE_PAYLOAD) => void) | null = null;
    const api = createFakeShareApi();
    api.getPublicSharePayload.mockImplementation(
      () =>
        new Promise((r) => {
          resolvePayload = r as (v: typeof FIXTURE_PUBLIC_SHARE_PAYLOAD) => void;
        }),
    );
    renderView(api);
    expect(screen.getByText(/loading shareable/i)).toBeInTheDocument();
    await act(async () => {
      resolvePayload?.(FIXTURE_PUBLIC_SHARE_PAYLOAD);
    });
    await waitFor(() => {
      expect(screen.getByTestId('share-header')).toBeInTheDocument();
    });
  });

  it('renders the error state when the api throws', async () => {
    const api = createFakeShareApi({ rejectAll: new Error('backend on fire') });
    renderView(api);
    await waitFor(() => {
      expect(screen.getByTestId('share-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('share-error')).toHaveTextContent('backend on fire');
  });

  it('falls back to a generic message when the error has no message', async () => {
    const api = createFakeShareApi({ rejectAll: new Error('') });
    renderView(api);
    await waitFor(() => {
      expect(screen.getByTestId('share-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('share-error')).toHaveTextContent(
      /could not load this shareable/i,
    );
  });
});

describe('ShareableView — not found', () => {
  it('renders the not-found state when the api returns null', async () => {
    const api = createFakeShareApi({ notFound: true });
    renderView(api);
    await waitFor(() => {
      expect(screen.getByTestId('share-not-found')).toBeInTheDocument();
    });
  });

  it('invokes onNotFound() exactly once when the api returns null', async () => {
    const api = createFakeShareApi({ notFound: true });
    const onNotFound = vi.fn();
    renderView(api, { onNotFound });
    await waitFor(() => {
      expect(onNotFound).toHaveBeenCalled();
    });
  });
});

describe('ShareableView — header', () => {
  it('renders the collection title and owner handle', async () => {
    const api = createFakeShareApi();
    renderView(api);
    await waitFor(() => {
      expect(screen.getByTestId('share-header')).toBeInTheDocument();
    });
    expect(screen.getByTestId('share-header-title')).toHaveTextContent(
      FIXTURE_PUBLIC_SHARE_PAYLOAD.collectionTitle,
    );
    expect(screen.getByTestId('share-header-owner')).toHaveTextContent(
      `@${FIXTURE_PUBLIC_SHARE_PAYLOAD.owner.handle}`,
    );
  });

  it('renders the description when present', async () => {
    const api = createFakeShareApi();
    renderView(api);
    await waitFor(() => {
      expect(screen.getByTestId('share-header')).toBeInTheDocument();
    });
    expect(screen.getByTestId('share-header-description')).toHaveTextContent(
      FIXTURE_PUBLIC_SHARE_PAYLOAD.description!,
    );
  });

  it('omits the description block when null', async () => {
    const api = createFakeShareApi({
      payload: makePublicSharePayload({ description: null }),
    });
    renderView(api);
    await waitFor(() => {
      expect(screen.getByTestId('share-header')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('share-header-description')).toBeNull();
  });

  it('uses the display name when the owner has one set', async () => {
    const api = createFakeShareApi({
      payload: makePublicSharePayload({
        owner: makePublicShareOwner({ handle: 'pablo', displayName: 'Pablo M.' }),
      }),
    });
    renderView(api);
    await waitFor(() => {
      expect(screen.getByTestId('share-header-owner')).toHaveTextContent('Pablo M.');
    });
  });

  it('falls back to @handle when displayName is null', async () => {
    const api = createFakeShareApi({
      payload: makePublicSharePayload({
        owner: makePublicShareOwner({ handle: 'anon', displayName: null }),
      }),
    });
    renderView(api);
    await waitFor(() => {
      expect(screen.getByTestId('share-header-owner')).toHaveTextContent('@anon');
    });
  });

  it('renders a relative last-updated string with a deterministic now', async () => {
    const api = createFakeShareApi({
      payload: makePublicSharePayload({ lastUpdatedAt: '2026-05-13T12:00:00.000Z' }),
    });
    renderView(api, { now: new Date('2026-05-15T12:00:00.000Z') });
    await waitFor(() => {
      expect(screen.getByTestId('share-header-updated')).toHaveTextContent('2 days ago');
    });
  });
});

describe('ShareableView — summary', () => {
  it('renders the cards-owned tally and completion %', async () => {
    const api = createFakeShareApi();
    renderView(api);
    await waitFor(() => {
      expect(screen.getByTestId('share-summary')).toBeInTheDocument();
    });
    expect(screen.getByTestId('share-summary-tally')).toHaveTextContent('142 / 1,832 cards');
    expect(screen.getByTestId('share-summary-completion')).toHaveTextContent('7.8%');
  });

  it('renders a total-copies stat only when it differs from unique count', async () => {
    const api = createFakeShareApi();
    renderView(api);
    await waitFor(() => {
      expect(screen.getByTestId('share-summary')).toBeInTheDocument();
    });
    expect(screen.getByTestId('share-summary-quantity')).toHaveTextContent('167');
  });

  it('hides the total-copies stat when ownedUnique === ownedTotalQuantity', async () => {
    const api = createFakeShareApi({
      payload: makePublicSharePayload({
        counts: {
          ownedUnique: 10,
          ownedTotalQuantity: 10,
          catalogTotal: 50,
          completionPct: 20,
        },
      }),
    });
    renderView(api);
    await waitFor(() => {
      expect(screen.getByTestId('share-summary')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('share-summary-quantity')).toBeNull();
  });

  it('falls back to the degraded count copy when catalogTotal is 0', async () => {
    const api = createFakeShareApi({
      payload: makePublicSharePayload({
        counts: {
          ownedUnique: 0,
          ownedTotalQuantity: 0,
          catalogTotal: 0,
          completionPct: 0,
        },
      }),
    });
    renderView(api);
    await waitFor(() => {
      expect(screen.getByTestId('share-summary')).toBeInTheDocument();
    });
    expect(screen.getByTestId('share-summary-empty')).toHaveTextContent('0 cards owned');
  });
});

describe('ShareableView — member grid', () => {
  it('renders one tile per member', async () => {
    const api = createFakeShareApi();
    renderView(api);
    await waitFor(() => {
      expect(screen.getByTestId('share-member-list')).toBeInTheDocument();
    });
    expect(screen.getAllByTestId('share-member-tile')).toHaveLength(FIXTURE_MEMBERS.length);
  });

  it('links each tile to /cards/[printingId]', async () => {
    const api = createFakeShareApi();
    renderView(api);
    await waitFor(() => {
      expect(screen.getByTestId('share-member-list')).toBeInTheDocument();
    });
    const hrefs = screen
      .getAllByTestId('share-member-link')
      .map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      `/cards/${encodeURIComponent(FIXTURE_MEMBERS[0]!.printingId)}`,
      `/cards/${encodeURIComponent(FIXTURE_MEMBERS[1]!.printingId)}`,
      `/cards/${encodeURIComponent(FIXTURE_MEMBERS[2]!.printingId)}`,
    ]);
  });

  it('renders alt text for every image', async () => {
    const api = createFakeShareApi();
    renderView(api);
    await waitFor(() => {
      expect(screen.getByTestId('share-member-list')).toBeInTheDocument();
    });
    const images = screen.getAllByTestId('share-member-image');
    expect(images.length).toBeGreaterThan(0);
    for (const img of images) {
      expect((img as HTMLImageElement).alt.length).toBeGreaterThan(0);
    }
  });

  it('renders the empty state when there are no members', async () => {
    const api = createFakeShareApi({
      payload: makePublicSharePayload({ members: [] }),
    });
    renderView(api);
    await waitFor(() => {
      expect(screen.getByTestId('share-member-empty')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('share-member-list')).toBeNull();
  });
});

describe('ShareableView — footer signup CTA', () => {
  it('renders the signup button and links to /auth/sign-in?signup=1', async () => {
    const api = createFakeShareApi();
    renderView(api);
    await waitFor(() => {
      expect(screen.getByTestId('share-footer')).toBeInTheDocument();
    });
    const link = screen.getByTestId('share-signup-link');
    expect(link.getAttribute('href')).toBe('/auth/sign-in?signup=1');
  });

  it('renders the canonical /c/handle/slug URL in the footer', async () => {
    const api = createFakeShareApi();
    renderView(api, { handle: 'pablo', slug: 'starter' });
    await waitFor(() => {
      expect(screen.getByTestId('share-footer')).toBeInTheDocument();
    });
    expect(screen.getByTestId('share-footer-url')).toHaveTextContent('/c/pablo/starter');
  });
});

describe('ShareableView — api wiring', () => {
  it('passes handle + slug + signal to the api', async () => {
    const api = createFakeShareApi();
    renderView(api, { handle: 'with-dash', slug: 'cool-slug' });
    await waitFor(() => {
      expect(api.getPublicSharePayload).toHaveBeenCalled();
    });
    const call = api.getPublicSharePayload.mock.calls[0]?.[0];
    expect(call).toMatchObject({ handle: 'with-dash', slug: 'cool-slug' });
    expect(call?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('ShareableView — theming', () => {
  function renderThemed(theme: ShareableTheme): void {
    const api = createFakeShareApi({
      payload: makePublicSharePayload({ shareable: makeShareableDto({ theme }) }),
    });
    renderView(api);
  }

  it('renders the resolved theme root for the stored theme id', async () => {
    renderThemed('gold');
    await waitFor(() => {
      expect(screen.getByTestId('share-header')).toBeInTheDocument();
    });
    expect(document.querySelector('[data-share-theme="gold"]')).not.toBeNull();
  });

  it('renders the default theme root for the default id', async () => {
    renderThemed('default');
    await waitFor(() => {
      expect(screen.getByTestId('share-header')).toBeInTheDocument();
    });
    expect(document.querySelector('[data-share-theme="default"]')).not.toBeNull();
  });

  it('falls back to the default theme root for an unknown stored id', async () => {
    const api = createFakeShareApi({
      payload: makePublicSharePayload({
        shareable: makeShareableDto({ theme: 'holo' as unknown as ShareableTheme }),
      }),
    });
    renderView(api);
    await waitFor(() => {
      expect(screen.getByTestId('share-header')).toBeInTheDocument();
    });
    expect(document.querySelector('[data-share-theme="default"]')).not.toBeNull();
    expect(document.querySelector('[data-share-theme="holo"]')).toBeNull();
  });

  it('renders the accent band for a band-header theme', async () => {
    renderThemed('dark');
    await waitFor(() => {
      expect(screen.getByTestId('share-theme-band')).toBeInTheDocument();
    });
  });

  it('omits the accent band for the default (plain-header) theme', async () => {
    renderThemed('default');
    await waitFor(() => {
      expect(screen.getByTestId('share-header')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('share-theme-band')).toBeNull();
  });
});
