// `/c/[handle]/[slug]` — public shareable page (no auth).
//
// A logged-out visitor lands here from a share URL or a social
// unfurler. The page renders SSR-friendly metadata via
// `generateMetadata()` (so Twitter / iMessage / Slack previews
// resolve to the right title + OG image) and delegates the body
// to `<ShareableRoute>`, the same `force-dynamic` + lazy
// `getApiClient()` pattern T-W-BROWSE / T-W-COLLECTION ship.
//
// We keep `dynamic = 'force-dynamic'` so `next build` does NOT
// attempt a static prerender (and therefore does not require
// `NEXT_PUBLIC_SUPABASE_*` env vars at build time — the
// iter-14 W-SHELL hotfix lesson). At request time, the route
// renders normally; crawlers receive the meta from
// `generateMetadata` plus the OG image from the sibling
// `opengraph-image.tsx` route.

import { ShareableRoute } from '../../../../components/share/ShareableRoute';
import { publicShareUrl } from '../../../../lib/share/format';

import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

interface PageParams {
  params: { handle: string; slug: string };
}

/**
 * Page-level metadata. Resolves entirely from the URL params —
 * we deliberately do NOT make an extra network call here just to
 * personalise the title because (a) the OG image route already
 * resolves the payload and (b) failing the meta render due to
 * the api-client being down is a worse UX than a generic title.
 * Crawlers will still receive the dynamic OG image from the
 * sibling `opengraph-image.tsx`.
 */
export function generateMetadata({ params }: PageParams): Metadata {
  const url = publicShareUrl(params.handle, params.slug);
  const title = `@${params.handle} on Binderly`;
  const description = `Browse @${params.handle}'s Pokémon TCG collection on Binderly.`;
  // T-SH-OG-IMAGES routes the dynamic OG card through
  // `/api/og/share/[handle]/[slug]` (the rich card-grid hero).
  // The sibling file-based `opengraph-image.tsx` route stays in
  // place as a passive fallback (Next.js still resolves it for
  // `og:image` consumers that read the file convention directly).
  const ogImageUrl = `/api/og/share/${encodeURIComponent(params.handle)}/${encodeURIComponent(params.slug)}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: 'Binderly',
      type: 'website',
      images: [{ url: ogImageUrl, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImageUrl],
    },
  };
}

export default function PublicShareablePage({ params }: PageParams): React.ReactNode {
  return <ShareableRoute handle={params.handle} slug={params.slug} />;
}
