// Pure-renderer tests for the OG card.
//
// Satori takes JSX in, but our tests don't run Satori — they
// exercise the same JSX through `react-dom/server`'s
// `renderToStaticMarkup` to produce HTML we can assert against.
// This catches the same content/layout regressions Satori would
// surface (because the same component tree is walked) without
// the WASM-binding overhead.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ogPaletteForTheme } from '../../../app/c/themes/og-palette';
import { GOLD_THEME } from '../../../app/c/themes/registry';
import { makePublicSharePayload } from '../../share/fixtures';
import { BRAND } from '../brand';
import { renderOgFallback } from '../fallback';
import { PLACEHOLDER_DATA_URI } from '../placeholder';
import {
  renderOgImage,
  OG_SIZE,
  buildStatLine,
  DEFAULT_OG_PALETTE,
  ogBackgroundGradient,
} from '../render';

const FOUR_PLACEHOLDERS = [
  PLACEHOLDER_DATA_URI,
  PLACEHOLDER_DATA_URI,
  PLACEHOLDER_DATA_URI,
  PLACEHOLDER_DATA_URI,
];

describe('OG_SIZE', () => {
  it('declares the canonical 1200×630 OG size', () => {
    expect(OG_SIZE).toEqual({ width: 1200, height: 630 });
  });
});

describe('buildStatLine', () => {
  it('uses the X / Y · % complete copy when catalogTotal > 0', () => {
    const line = buildStatLine(makePublicSharePayload());
    expect(line).toContain('142 / 1,832');
    expect(line).toContain('7.8%');
    expect(line).toContain('complete');
  });

  it('falls back to the cards-owned variant when catalogTotal is 0', () => {
    const payload = makePublicSharePayload({
      counts: { ownedUnique: 12, ownedTotalQuantity: 14, catalogTotal: 0, completionPct: 0 },
    });
    const line = buildStatLine(payload);
    expect(line).toContain('12');
    expect(line).toContain('cards owned');
  });
});

describe('renderOgImage — content', () => {
  const payload = makePublicSharePayload();

  it('renders the collection title', () => {
    const customPayload = makePublicSharePayload({
      collectionTitle: 'Pablos Charizard binder',
    });
    const html = renderToStaticMarkup(
      renderOgImage({
        handle: 'pablo',
        slug: 'binder',
        payload: customPayload,
        thumbnailUris: FOUR_PLACEHOLDERS,
      }),
    );
    expect(html).toContain('Pablos Charizard binder');
  });

  it('renders the owner display name when present', () => {
    const html = renderToStaticMarkup(
      renderOgImage({
        handle: 'pablo',
        slug: 'binder',
        payload,
        thumbnailUris: FOUR_PLACEHOLDERS,
      }),
    );
    expect(html).toContain(payload.owner.displayName ?? '!!unset');
  });

  it('renders the @{handle} subtitle in the header', () => {
    const html = renderToStaticMarkup(
      renderOgImage({
        handle: 'pablo',
        slug: 'binder',
        payload,
        thumbnailUris: FOUR_PLACEHOLDERS,
      }),
    );
    expect(html).toContain('@pablo');
  });

  it('renders "Pokémon collection by" subtitle', () => {
    const html = renderToStaticMarkup(
      renderOgImage({
        handle: 'pablo',
        slug: 'binder',
        payload,
        thumbnailUris: FOUR_PLACEHOLDERS,
      }),
    );
    expect(html).toContain('Pok');
    expect(html).toContain('collection');
  });

  it('renders the canonical /c/{handle}/{slug} url in the footer', () => {
    const html = renderToStaticMarkup(
      renderOgImage({
        handle: 'pablo',
        slug: 'my-binder',
        payload,
        thumbnailUris: FOUR_PLACEHOLDERS,
      }),
    );
    expect(html).toContain('/c/pablo/my-binder');
  });

  it('renders the stat line', () => {
    const html = renderToStaticMarkup(
      renderOgImage({
        handle: 'pablo',
        slug: 'my-binder',
        payload,
        thumbnailUris: FOUR_PLACEHOLDERS,
      }),
    );
    expect(html).toContain('7.8%');
  });

  it('renders exactly 4 image tiles when 4 URIs are provided', () => {
    const html = renderToStaticMarkup(
      renderOgImage({
        handle: 'pablo',
        slug: 'my-binder',
        payload,
        thumbnailUris: ['data:image/png;base64,a', 'data:image/png;base64,b', 'data:image/png;base64,c', 'data:image/png;base64,d'],
      }),
    );
    expect(countOccurrences(html, '<img')).toBe(4);
  });

  it('renders only as many tiles as URIs (capped to slice limit)', () => {
    const html = renderToStaticMarkup(
      renderOgImage({
        handle: 'pablo',
        slug: 'my-binder',
        payload,
        thumbnailUris: ['data:image/png;base64,a', 'data:image/png;base64,b'],
      }),
    );
    expect(countOccurrences(html, '<img')).toBe(2);
  });

  it('passes the data URIs straight into the <img src>', () => {
    const html = renderToStaticMarkup(
      renderOgImage({
        handle: 'pablo',
        slug: 'my-binder',
        payload,
        thumbnailUris: ['data:image/png;base64,A', 'data:image/png;base64,B', 'data:image/png;base64,C', 'data:image/png;base64,D'],
      }),
    );
    expect(html).toContain('src="data:image/png;base64,A"');
    expect(html).toContain('src="data:image/png;base64,D"');
  });

  it('uses the brand background gradient on the outer container', () => {
    const html = renderToStaticMarkup(
      renderOgImage({
        handle: 'pablo',
        slug: 'binder',
        payload,
        thumbnailUris: FOUR_PLACEHOLDERS,
      }),
    );
    expect(html).toContain('linear-gradient');
  });

  it('defaults to the brand palette colours when no palette is supplied', () => {
    const html = renderToStaticMarkup(
      renderOgImage({
        handle: 'pablo',
        slug: 'binder',
        payload,
        thumbnailUris: FOUR_PLACEHOLDERS,
      }),
    );
    // Brand background + brand teal accent (the default-palette fallback).
    expect(html).toContain(BRAND.background);
    expect(html).toContain(BRAND.primary);
  });

  it('falls back to @{handle} when displayName is null', () => {
    const payloadNoName = makePublicSharePayload({
      owner: {
        handle: 'someone',
        displayName: null,
        avatarUrl: null,
        bio: null,
        socialLinks: [],
        tier: 'pro',
      },
    });
    const html = renderToStaticMarkup(
      renderOgImage({
        handle: 'someone',
        slug: 'binder',
        payload: payloadNoName,
        thumbnailUris: FOUR_PLACEHOLDERS,
      }),
    );
    expect(html).toContain('@someone');
  });
});

describe('ogBackgroundGradient', () => {
  it('derives a 3-stop 135° gradient from the palette', () => {
    const gradient = ogBackgroundGradient(GOLD_THEME.palette);
    expect(gradient).toContain('linear-gradient(135deg');
    expect(gradient).toContain(GOLD_THEME.palette.background);
    expect(gradient).toContain(GOLD_THEME.palette.surface);
    expect(gradient).toContain(GOLD_THEME.palette.accent);
  });

  it('DEFAULT_OG_PALETTE mirrors the brand tokens', () => {
    expect(DEFAULT_OG_PALETTE.background).toBe(BRAND.background);
    expect(DEFAULT_OG_PALETTE.surface).toBe(BRAND.surface);
    expect(DEFAULT_OG_PALETTE.text).toBe(BRAND.text);
    expect(DEFAULT_OG_PALETTE.accent).toBe(BRAND.primary);
  });
});

describe('renderOgImage — theme palette wiring (#FU-62)', () => {
  const payload = makePublicSharePayload();

  it('paints the hero with the supplied theme palette colours', () => {
    const palette = ogPaletteForTheme('gold');
    const html = renderToStaticMarkup(
      renderOgImage({
        handle: 'pablo',
        slug: 'binder',
        payload,
        thumbnailUris: FOUR_PLACEHOLDERS,
        palette,
      }),
    );
    // Gold theme background + accent appear; the brand defaults do not
    // dominate the hero.
    expect(html).toContain(GOLD_THEME.palette.background);
    expect(html).toContain(GOLD_THEME.palette.accent);
  });

  it('renders a palette-derived gradient (not the fixed brand gradient)', () => {
    const palette = ogPaletteForTheme('gold');
    const html = renderToStaticMarkup(
      renderOgImage({
        handle: 'pablo',
        slug: 'binder',
        payload,
        thumbnailUris: FOUR_PLACEHOLDERS,
        palette,
      }),
    );
    expect(html).toContain('linear-gradient');
    expect(html).toContain(GOLD_THEME.palette.accent);
  });

  it('uses the wordmark/title text colour from the palette', () => {
    const palette = ogPaletteForTheme('gold');
    const html = renderToStaticMarkup(
      renderOgImage({
        handle: 'pablo',
        slug: 'binder',
        payload,
        thumbnailUris: FOUR_PLACEHOLDERS,
        palette,
      }),
    );
    expect(html).toContain(GOLD_THEME.palette.text);
  });
});

describe('renderOgFallback', () => {
  it('renders the Binderly wordmark', () => {
    const html = renderToStaticMarkup(renderOgFallback());
    expect(html).toContain('Binderly');
  });

  it('renders a generic subtitle when no handle is supplied', () => {
    const html = renderToStaticMarkup(renderOgFallback());
    expect(html).toContain('community');
  });

  it('echoes the handle into the subtitle when present', () => {
    const html = renderToStaticMarkup(renderOgFallback({ handle: 'someone' }));
    expect(html).toContain('@someone');
  });

  it('uses the brand gradient on the outer container', () => {
    const html = renderToStaticMarkup(renderOgFallback());
    expect(html).toContain('linear-gradient');
  });

  it('does not contain any <img> tags (pure brand card)', () => {
    const html = renderToStaticMarkup(renderOgFallback());
    expect(countOccurrences(html, '<img')).toBe(0);
  });
});

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}
