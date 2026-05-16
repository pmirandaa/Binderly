import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import PublicShareablePage, { generateMetadata } from './page';
import { createFakeShareApi } from '../../../../lib/share/fixtures';
import { renderWithProviders } from '../../../../test-utils/render';

const fakeApi = createFakeShareApi();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/c/pablo/my-binder',
  useSearchParams: () => new URLSearchParams(),
  notFound: vi.fn(),
}));

vi.mock('../../../../lib/share/api', async () => {
  const actual = await vi.importActual('../../../../lib/share/api');
  return {
    ...(actual as object),
    apiToShareApi: (): typeof fakeApi => fakeApi,
  };
});

vi.mock('../../../../lib/api-client', () => ({
  getApiClient: () => ({}),
}));

describe('/c/[handle]/[slug] page', () => {
  it('renders the ShareableRoute wired to the (mocked) api-client', async () => {
    renderWithProviders(<PublicShareablePage params={{ handle: 'pablo', slug: 'my-binder' }} />);
    await waitFor(() => {
      expect(screen.getByTestId('share-page')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId('share-header-title')).toBeInTheDocument();
    });
  });

  it('forwards handle + slug to the api', async () => {
    renderWithProviders(<PublicShareablePage params={{ handle: 'pablo', slug: 'cards' }} />);
    await waitFor(() => {
      expect(fakeApi.getPublicSharePayload).toHaveBeenCalled();
    });
    const call = fakeApi.getPublicSharePayload.mock.calls.at(-1)?.[0];
    expect(call?.handle).toBe('pablo');
    expect(call?.slug).toBe('cards');
  });
});

describe('/c/[handle]/[slug] generateMetadata', () => {
  it('returns title, description, and canonical URL derived from params', () => {
    const meta = generateMetadata({ params: { handle: 'pablo', slug: 'my-binder' } });
    expect(meta.title).toBe('@pablo on Binderly');
    expect(meta.description).toContain('pablo');
    expect(meta.alternates?.canonical).toBe('/c/pablo/my-binder');
  });

  it('emits OpenGraph + Twitter card metadata', () => {
    const meta = generateMetadata({ params: { handle: 'pablo', slug: 'my-binder' } });
    expect(meta.openGraph?.url).toBe('/c/pablo/my-binder');
    expect(meta.openGraph?.siteName).toBe('Binderly');
    const twitter = meta.twitter as { card?: string } | undefined;
    expect(twitter?.card).toBe('summary_large_image');
  });

  it('encodes path-unsafe characters in the canonical URL', () => {
    const meta = generateMetadata({ params: { handle: 'pa blo', slug: 'foo/bar' } });
    expect(meta.alternates?.canonical).toBe('/c/pa%20blo/foo%2Fbar');
  });
});
