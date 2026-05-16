import { fireEvent } from '@testing-library/react';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BuyCta, openTcgplayerUrl } from './BuyCta.js';
import { MOBILE_TCGPLAYER_AFFILIATE_ID_ENV } from './tcgplayer.js';
import { renderWithProvider } from '../../test-utils/render.js';

vi.mock('expo-web-browser', () => ({
  openBrowserAsync: vi.fn(async () => ({ type: 'opened' })),
}));

// `expo-linking` is mocked by the global test setup; re-import here
// purely so `Linking.openURL` resolves to the same mock the setup
// installed (vitest dedupes module identity).

const CARD = {
  cardName: 'Charizard',
  setName: 'Base Set',
  number: '4',
} as const;

let originalEnvValue: string | undefined;

beforeEach(() => {
  originalEnvValue = process.env[MOBILE_TCGPLAYER_AFFILIATE_ID_ENV];
  delete process.env[MOBILE_TCGPLAYER_AFFILIATE_ID_ENV];
  vi.mocked(WebBrowser.openBrowserAsync).mockClear();
  vi.mocked(WebBrowser.openBrowserAsync).mockResolvedValue({ type: 'opened' } as never);
  vi.mocked(Linking.openURL).mockClear();
  vi.mocked(Linking.openURL).mockResolvedValue(true);
});

afterEach(() => {
  if (originalEnvValue === undefined) {
    delete process.env[MOBILE_TCGPLAYER_AFFILIATE_ID_ENV];
  } else {
    process.env[MOBILE_TCGPLAYER_AFFILIATE_ID_ENV] = originalEnvValue;
  }
});

describe('<BuyCta> (mobile) — enabled path', () => {
  it('renders the enabled button when an affiliate id is supplied', () => {
    const result = renderWithProvider(<BuyCta card={CARD} affiliateId="aff-mobile" />);
    const button = result.getByTestId('buy-cta-button');
    expect(button.getAttribute('aria-disabled')).not.toBe('true');
    expect(button.textContent).toContain('Buy on TCGplayer');
  });

  it('does not render the disabled wrapper or hint when enabled', () => {
    const result = renderWithProvider(<BuyCta card={CARD} affiliateId="aff-mobile" />);
    expect(result.queryByTestId('buy-cta-disabled')).toBeNull();
    expect(result.queryByTestId('buy-cta-hint')).toBeNull();
  });

  it('invokes the onOpenUrl seam with the built TCGplayer URL on press', () => {
    const opener = vi.fn();
    const result = renderWithProvider(
      <BuyCta card={CARD} affiliateId="aff-mobile" onOpenUrl={opener} />,
    );
    fireEvent.click(result.getByTestId('buy-cta-button'));
    expect(opener).toHaveBeenCalledTimes(1);
    const url = String(opener.mock.calls[0]?.[0] ?? '');
    expect(url).toContain('tcgplayer.com/search/pokemon/product');
    expect(url).toContain('utm_id=aff-mobile');
  });

  it('reads the affiliate id from EXPO_PUBLIC_TCGPLAYER_AFFILIATE_ID when no prop given', () => {
    process.env[MOBILE_TCGPLAYER_AFFILIATE_ID_ENV] = 'aff-from-env';
    const opener = vi.fn();
    const result = renderWithProvider(<BuyCta card={CARD} onOpenUrl={opener} />);
    fireEvent.click(result.getByTestId('buy-cta-button'));
    expect(opener).toHaveBeenCalledTimes(1);
    expect(String(opener.mock.calls[0]?.[0] ?? '')).toContain('utm_id=aff-from-env');
  });

  it('uses openBrowserAsync by default when no onOpenUrl prop is given', () => {
    const result = renderWithProvider(<BuyCta card={CARD} affiliateId="aff-mobile" />);
    fireEvent.click(result.getByTestId('buy-cta-button'));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledTimes(1);
    const url = String(vi.mocked(WebBrowser.openBrowserAsync).mock.calls[0]?.[0] ?? '');
    expect(url).toContain('tcgplayer.com');
  });
});

describe('<BuyCta> (mobile) — disabled path', () => {
  it('renders the disabled wrapper when no affiliate id is provided and env is unset', () => {
    const result = renderWithProvider(<BuyCta card={CARD} />);
    expect(result.queryByTestId('buy-cta-disabled')).not.toBeNull();
    const button = result.getByTestId('buy-cta-button');
    expect(button.getAttribute('aria-disabled')).toBe('true');
  });

  it('shows the "Coming soon" hint text in the disabled state', () => {
    const result = renderWithProvider(<BuyCta card={CARD} affiliateId={null} />);
    expect(result.getByTestId('buy-cta-hint').textContent).toContain('Coming soon');
  });

  it('uses an accessibility label that mentions "coming soon" when disabled', () => {
    const result = renderWithProvider(<BuyCta card={CARD} affiliateId="" />);
    const button = result.getByTestId('buy-cta-button');
    expect((button.getAttribute('aria-label') ?? '').toLowerCase()).toContain('coming soon');
  });

  it('does not invoke openBrowserAsync when the disabled button is pressed', () => {
    const result = renderWithProvider(<BuyCta card={CARD} />);
    fireEvent.click(result.getByTestId('buy-cta-button'));
    expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
  });
});

describe('openTcgplayerUrl', () => {
  it('forwards the URL to expo-web-browser.openBrowserAsync', async () => {
    await openTcgplayerUrl('https://tcgplayer.com/search/pokemon/product?q=test');
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(
      'https://tcgplayer.com/search/pokemon/product?q=test',
    );
  });

  it('falls back to Linking.openURL when openBrowserAsync throws', async () => {
    vi.mocked(WebBrowser.openBrowserAsync).mockRejectedValueOnce(new Error('no provider'));
    await openTcgplayerUrl('https://tcgplayer.com/x');
    expect(Linking.openURL).toHaveBeenCalledWith('https://tcgplayer.com/x');
  });

  it('swallows the error silently when both browsers fail', async () => {
    vi.mocked(WebBrowser.openBrowserAsync).mockRejectedValueOnce(new Error('no provider'));
    vi.mocked(Linking.openURL).mockRejectedValueOnce(new Error('no scheme handler'));
    await expect(openTcgplayerUrl('https://tcgplayer.com/x')).resolves.toBeUndefined();
  });
});
