'use client';

// Per-set view — header (name, release date, count, breadcrumb)
// + grid of printing thumbnails. The view is fed the set **slug**
// (`canonicalKey`, e.g. `en-base1`); it resolves the slug → set via
// the injected `BrowseApi` so tests can render without a real
// api-client. The slug convention matches mobile's `/sets/[slug]`
// route (#FU-64).
//
// Legacy compatibility: if the route segment is a set **UUID**
// (old `/sets/[id]` links), the view resolves it by id and
// `router.replace`s to the canonical slug URL so previously shared
// UUID links keep working.
//
// 404 is signalled by `onNotFound()` — the route file wraps that
// in `next/navigation`'s `notFound()`. Keeping the navigation
// concern in the route file lets the view stay framework-light
// (tests don't have to mock `notFound()`).

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { ApiNotFoundError } from '@binderly/api-client';
import { Text, XStack, YStack } from '@binderly/ui';


import { PrintingThumbnail } from './PrintingThumbnail';
import { formatReleaseDate, languageLabel, printingDisplayName } from '../../lib/browse/format';
import { PageLoading } from '../loading/PageLoading';

import type { BrowseApi, PrintingsForSet } from '../../lib/browse/api';

export interface SetViewProps {
  api: BrowseApi;
  /** The set's `canonicalKey` slug (e.g. `en-base1`), or a legacy set UUID. */
  slug: string;
  /**
   * Called when the api-client reports the slug doesn't resolve to a
   * set. The route file passes a callback that triggers Next.js's
   * `notFound()` rendering the closest `not-found.tsx`.
   */
  onNotFound?: () => void;
}

type FetchState =
  | { kind: 'loading' }
  | { kind: 'redirecting' }
  | { kind: 'ready'; data: PrintingsForSet }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string };

/** Matches a canonical RFC-4122 UUID (the legacy `/sets/[id]` shape). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function SetView({ api, slug, onNotFound }: SetViewProps): React.ReactNode {
  const router = useRouter();
  // Keep `router` out of the effect deps: `useRouter()` returns a
  // fresh object on every render (notably under test mocks), and
  // depending on it would re-run the fetch effect on every render —
  // an infinite loop. A ref gives the effect the latest router
  // without making it a dependency.
  const routerRef = useRef(router);
  routerRef.current = router;
  const [state, setState] = useState<FetchState>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });

    async function load(): Promise<void> {
      try {
        // Legacy UUID URL → resolve by id and redirect to the slug URL.
        if (UUID_RE.test(slug)) {
          const set = await api.getSet(slug, controller.signal);
          if (controller.signal.aborted) return;
          setState({ kind: 'redirecting' });
          routerRef.current.replace(`/sets/${encodeURIComponent(set.canonicalKey)}`);
          return;
        }
        const set = await api.getSetBySlug(slug, controller.signal);
        if (controller.signal.aborted) return;
        const data = await api.listPrintingsInSet(set.id, controller.signal);
        if (controller.signal.aborted) return;
        setState({ kind: 'ready', data });
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (error instanceof ApiNotFoundError) {
          setState({ kind: 'not-found' });
          return;
        }
        const message =
          error instanceof Error && error.message.length > 0
            ? error.message
            : 'Failed to load this set.';
        setState({ kind: 'error', message });
      }
    }

    void load();
    return (): void => {
      controller.abort();
    };
  }, [api, slug]);

  if (state.kind === 'not-found') {
    // `notFound()` MUST be called during render (per the Next.js
    // App Router contract) to trigger the closest `not-found.tsx`
    // boundary. We funnel the effect's catch into a state flag,
    // then call the navigation callback synchronously below.
    if (onNotFound !== undefined) onNotFound();
    return (
      <YStack padding="$6" gap="$4" maxWidth={1200} marginHorizontal="auto" data-testid="set-page">
        <Breadcrumb />
        <YStack
          padding="$5"
          gap="$2"
          backgroundColor="$surfaceMuted"
          borderRadius={12}
          data-testid="set-error"
          role="alert"
        >
          <Text variant="subtitle">Set not found</Text>
          <Text variant="body" tone="muted">
            We couldn&apos;t find that set in the catalog.
          </Text>
        </YStack>
      </YStack>
    );
  }

  if (state.kind === 'loading' || state.kind === 'redirecting') {
    return (
      <YStack padding="$6" gap="$4" maxWidth={1200} marginHorizontal="auto" data-testid="set-page">
        <Breadcrumb />
        <PageLoading label="Loading set…" />
      </YStack>
    );
  }

  if (state.kind === 'error') {
    return (
      <YStack padding="$6" gap="$4" maxWidth={1200} marginHorizontal="auto" data-testid="set-page">
        <Breadcrumb />
        <YStack
          padding="$5"
          gap="$2"
          backgroundColor="$surfaceMuted"
          borderRadius={12}
          data-testid="set-error"
          role="alert"
        >
          <Text variant="subtitle">Could not load this set</Text>
          <Text variant="body" tone="muted">
            {state.message}
          </Text>
        </YStack>
      </YStack>
    );
  }

  const { set, cards } = state.data;
  const totalPrintings = cards.reduce((acc, card) => acc + card.printings.length, 0);

  return (
    <YStack
      padding="$6"
      gap="$5"
      maxWidth={1200}
      marginHorizontal="auto"
      data-testid="set-page"
    >
      <Breadcrumb />

      <YStack gap="$2" data-testid="set-header">
        <Text variant="title" data-testid="set-header-name">
          {set.name}
        </Text>
        <Text variant="body" tone="muted" data-testid="set-header-meta">
          {formatReleaseDate(set.releaseDate)} · {languageLabel(set.language)} ·{' '}
          {set.total ?? set.printedTotal ?? cards.length} cards · {totalPrintings} printings
        </Text>
      </YStack>

      {cards.length === 0 ? (
        <YStack
          padding="$6"
          gap="$2"
          alignItems="center"
          data-testid="set-empty"
        >
          <Text variant="subtitle">No printings yet</Text>
          <Text variant="body" tone="muted">
            The catalog hasn&apos;t ingested cards for this set yet.
          </Text>
        </YStack>
      ) : (
        <XStack flexWrap="wrap" gap="$4" data-testid="set-grid">
          {cards.flatMap((card) =>
            card.printings.map((printing) => (
              <YStack key={printing.id} width={200} flexBasis={200}>
                <PrintingThumbnail
                  href={`/cards/${encodeURIComponent(printing.id)}`}
                  cardName={card.name}
                  cardNumber={card.number}
                  variantLabel={printing.variantClass.replace(/_/g, ' ').toLowerCase()}
                  imageUrl={printing.imageSmallUrl}
                  altText={printingDisplayName({
                    cardName: card.name,
                    cardNumber: card.number,
                    variantClass: printing.variantClass,
                  })}
                />
              </YStack>
            )),
          )}
        </XStack>
      )}
    </YStack>
  );
}

function Breadcrumb(): React.ReactNode {
  return (
    <Link href="/browse" style={{ textDecoration: 'none' }} data-testid="set-back-link">
      <Text variant="bodySmall" tone="primary">
        ← Browse all sets
      </Text>
    </Link>
  );
}
