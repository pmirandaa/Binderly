import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BuyCta } from './BuyCta';
import { WEB_TCGPLAYER_AFFILIATE_ID_ENV } from '../../lib/affiliate';
import { renderWithProviders } from '../../test-utils/render';

const CARD = {
  cardName: 'Charizard',
  setName: 'Base Set',
  number: '4',
} as const;

let originalEnvValue: string | undefined;

beforeEach(() => {
  originalEnvValue = process.env[WEB_TCGPLAYER_AFFILIATE_ID_ENV];
  delete process.env[WEB_TCGPLAYER_AFFILIATE_ID_ENV];
});

afterEach(() => {
  if (originalEnvValue === undefined) {
    delete process.env[WEB_TCGPLAYER_AFFILIATE_ID_ENV];
  } else {
    process.env[WEB_TCGPLAYER_AFFILIATE_ID_ENV] = originalEnvValue;
  }
});

describe('<BuyCta> — enabled path', () => {
  it('renders an anchor with target="_blank" pointing at TCGplayer when affiliate id is provided', () => {
    renderWithProviders(<BuyCta card={CARD} affiliateId="aff-123" />);
    const anchor = screen.getByTestId('buy-cta-link');
    expect(anchor.tagName).toBe('A');
    expect(anchor.getAttribute('href')).toContain('tcgplayer.com/search/pokemon/product');
    expect(anchor.getAttribute('href')).toContain('utm_id=aff-123');
    expect(anchor.getAttribute('target')).toBe('_blank');
    expect(anchor.getAttribute('rel') ?? '').toContain('noopener');
    expect(anchor.getAttribute('rel') ?? '').toContain('noreferrer');
  });

  it('uses the rel="sponsored" hint so search engines treat the link as an affiliate', () => {
    renderWithProviders(<BuyCta card={CARD} affiliateId="aff-123" />);
    const anchor = screen.getByTestId('buy-cta-link');
    expect(anchor.getAttribute('rel') ?? '').toContain('sponsored');
  });

  it('renders the "Buy on TCGplayer" label inside the button', () => {
    renderWithProviders(<BuyCta card={CARD} affiliateId="aff-123" />);
    expect(screen.getByTestId('buy-cta-button').textContent).toContain('Buy on TCGplayer');
  });

  it('builds a URL that contains an encoded q= search composed of name + number + set', () => {
    renderWithProviders(<BuyCta card={CARD} affiliateId="aff-123" />);
    const href = screen.getByTestId('buy-cta-link').getAttribute('href') ?? '';
    const url = new URL(href);
    expect(url.searchParams.get('q')).toBe('Charizard 4 Base Set');
  });

  it('reads the affiliate id from process.env when no prop override is given', () => {
    process.env[WEB_TCGPLAYER_AFFILIATE_ID_ENV] = 'aff-from-env';
    renderWithProviders(<BuyCta card={CARD} />);
    const anchor = screen.getByTestId('buy-cta-link');
    expect(anchor.getAttribute('href')).toContain('utm_id=aff-from-env');
  });
});

describe('<BuyCta> — degraded "Coming soon" path', () => {
  it('renders the button as disabled when no affiliate id is given and env is unset', () => {
    renderWithProviders(<BuyCta card={CARD} />);
    expect(screen.queryByTestId('buy-cta-link')).toBeNull();
    const button = screen.getByTestId('buy-cta-button');
    expect(button.getAttribute('aria-disabled')).toBe('true');
  });

  it('wraps the disabled button in a tooltip span with "Coming soon" title', () => {
    renderWithProviders(<BuyCta card={CARD} affiliateId={null} />);
    const tooltip = screen.getByTestId('buy-cta-tooltip');
    expect(tooltip.getAttribute('title')).toBe('Coming soon');
    expect(tooltip.getAttribute('data-state')).toBe('disabled');
  });

  it('falls back to disabled when the affiliate id is an empty string', () => {
    renderWithProviders(<BuyCta card={CARD} affiliateId="" />);
    expect(screen.queryByTestId('buy-cta-link')).toBeNull();
    expect(screen.getByTestId('buy-cta-tooltip')).toBeInTheDocument();
  });

  it('falls back to disabled when env has the var set to whitespace', () => {
    process.env[WEB_TCGPLAYER_AFFILIATE_ID_ENV] = '   ';
    renderWithProviders(<BuyCta card={CARD} />);
    expect(screen.queryByTestId('buy-cta-link')).toBeNull();
    expect(screen.getByTestId('buy-cta-tooltip')).toBeInTheDocument();
  });

  it('surfaces an accessible label that mentions "coming soon" in the disabled state', () => {
    renderWithProviders(<BuyCta card={CARD} affiliateId={null} />);
    const button = screen.getByTestId('buy-cta-button');
    expect((button.getAttribute('aria-label') ?? '').toLowerCase()).toContain('coming soon');
  });

  it('falls back to disabled when the card name is empty even if affiliate id is set', () => {
    renderWithProviders(<BuyCta card={{ cardName: '' }} affiliateId="aff-123" />);
    expect(screen.queryByTestId('buy-cta-link')).toBeNull();
    expect(screen.getByTestId('buy-cta-tooltip')).toBeInTheDocument();
  });
});
