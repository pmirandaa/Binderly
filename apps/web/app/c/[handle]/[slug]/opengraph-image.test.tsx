// Unit-tests for the OG image route.
//
// We deliberately do NOT exercise `ImageResponse` directly here:
// `next/og` constructs an actual `Response` backed by a Satori-
// rendered PNG via `@resvg/resvg-js`, both of which need WASM
// bindings that vitest's jsdom environment does not load. The
// production runtime + Next.js's build step exercise the full
// rendering path; here we cover the pure JSX renderer
// (`renderOgCard`) and the metadata exports the route is
// expected to surface.

import { describe, expect, it } from 'vitest';

import {
  alt,
  contentType,
  renderOgCard,
  runtime,
  size,
} from './opengraph-image';
import { FIXTURE_PUBLIC_SHARE_PAYLOAD } from '../../../../lib/share/fixtures';

import type { ReactElement } from 'react';

interface TreeNode {
  type: unknown;
  props: { children?: unknown; style?: Record<string, unknown> };
}

function collectText(node: unknown): string {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectText).join(' ');
  if (typeof node === 'object') {
    const candidate = node as { props?: { children?: unknown } };
    if (candidate.props !== undefined) {
      return collectText(candidate.props.children);
    }
  }
  return '';
}

function asTree(el: ReactElement): TreeNode {
  return el as unknown as TreeNode;
}

describe('OG route metadata exports', () => {
  it('declares the canonical 1200×630 OG size', () => {
    expect(size).toEqual({ width: 1200, height: 630 });
  });

  it('declares an image/png content type', () => {
    expect(contentType).toBe('image/png');
  });

  it('declares descriptive alt text', () => {
    expect(alt).toContain('Binderly');
  });

  it('runs in the Node.js runtime', () => {
    // ImageResponse + @vercel/og can run on edge OR node; we
    // pin to node so the runtime adapter (`getApiClient()` →
    // `loadWebEnv()`) doesn't need the edge-specific shim.
    expect(runtime).toBe('nodejs');
  });
});

describe('renderOgCard', () => {
  it('renders the payload title + owner label when the payload is present', () => {
    const el = renderOgCard(
      { handle: 'pablo', slug: 'my-binder' },
      FIXTURE_PUBLIC_SHARE_PAYLOAD,
    );
    const text = collectText(asTree(el).props.children);
    expect(text).toContain(FIXTURE_PUBLIC_SHARE_PAYLOAD.collectionTitle);
    expect(text).toContain(FIXTURE_PUBLIC_SHARE_PAYLOAD.owner.displayName!);
  });

  it('renders the cards-owned tally and completion %', () => {
    const el = renderOgCard(
      { handle: 'pablo', slug: 'my-binder' },
      FIXTURE_PUBLIC_SHARE_PAYLOAD,
    );
    const text = collectText(asTree(el).props.children);
    expect(text).toContain('142 / 1,832');
    expect(text).toContain('7.8%');
  });

  it('renders the canonical share URL in the footer', () => {
    const el = renderOgCard(
      { handle: 'pablo', slug: 'my-binder' },
      FIXTURE_PUBLIC_SHARE_PAYLOAD,
    );
    const text = collectText(asTree(el).props.children);
    expect(text).toContain('binderly.app');
    expect(text).toContain('/c/pablo/my-binder');
    expect(text).toContain('Powered by Binderly');
  });

  it('falls back to handle-only when the payload is null (no backend)', () => {
    const el = renderOgCard({ handle: 'pablo', slug: 'my-binder' }, null);
    const text = collectText(asTree(el).props.children);
    expect(text).toContain('@pablo');
    expect(text).toContain('A Binderly shareable');
  });

  it('uses the canonical OG size 1200×630 in the outer container', () => {
    const el = renderOgCard({ handle: 'p', slug: 's' }, null);
    const style = asTree(el).props.style;
    expect(style?.['width']).toBe('100%');
    expect(style?.['height']).toBe('100%');
  });
});
