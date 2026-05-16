// `<BuyCta>` (mobile) — affiliate "Buy on TCGplayer" call-to-action.
//
// UX mirrors the web component (`apps/web/components/buy-cta/`): a
// primary button that opens the TCGplayer affiliate URL, degrading
// to a disabled "Coming soon" state when the affiliate id is
// unset.
//
// Implementation differences vs. web:
//
//   - Opens the URL via `expo-web-browser`'s `openBrowserAsync`. We
//     prefer the in-app browser over `Linking.openURL` because the
//     in-app browser preserves the user's session with TCGplayer
//     across visits (better affiliate attribution) and keeps users
//     a single back-swipe away from Binderly.
//   - On `openBrowserAsync` failure we fall back to
//     `Linking.openURL` so misconfigured devices (no Chrome custom
//     tabs / no SFSafariViewController) still get a working
//     external open.
//   - State persistence: we expose a small `data-testid` shim via
//     React Native's testID so the test suite can target the
//     enabled / disabled surfaces deterministically (mirroring the
//     web component's data-testids).

import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { Button, Text, YStack } from '@binderly/ui';

import {
  buildTcgplayerUrl,
  readMobileAffiliateId,
  type TcgplayerCardIdentifier,
} from './tcgplayer.js';

import type { ReactNode } from 'react';

const BUTTON_LABEL = 'Buy on TCGplayer';
const DISABLED_HINT = 'Coming soon';
const DISABLED_A11Y_LABEL = 'Buy on TCGplayer — coming soon';
const ENABLED_A11Y_LABEL = 'Buy on TCGplayer (opens browser)';

export interface BuyCtaProps {
  /** Card identifier used to build the TCGplayer search URL. */
  readonly card: TcgplayerCardIdentifier;
  /**
   * Explicit affiliate id override. Production callers leave this
   * unset and the component reads `EXPO_PUBLIC_TCGPLAYER_AFFILIATE_ID`
   * via `readMobileAffiliateId()`.
   */
  readonly affiliateId?: string | null;
  /**
   * Test seam — defaults to {@link openTcgplayerUrl}, but tests
   * inject a vi.fn() so they can assert the press handler fires
   * without invoking the real Expo modules.
   */
  readonly onOpenUrl?: (url: string) => Promise<unknown> | void;
  /** Test seam for the URL builder. */
  readonly buildUrl?: typeof buildTcgplayerUrl;
}

export function BuyCta(props: BuyCtaProps): ReactNode {
  const builder = props.buildUrl ?? buildTcgplayerUrl;
  const affiliateId = props.affiliateId === undefined ? readMobileAffiliateId() : props.affiliateId;
  const url = builder(props.card, { affiliateId });
  const opener = props.onOpenUrl ?? openTcgplayerUrl;

  if (url === null) {
    return (
      <YStack gap="$1" testID="buy-cta-disabled">
        <Button
          label={BUTTON_LABEL}
          variant="primary"
          size="lg"
          disabled
          accessibilityLabel={DISABLED_A11Y_LABEL}
          aria-label={DISABLED_A11Y_LABEL}
          testID="buy-cta-button"
        />
        <Text variant="caption" tone="muted" testID="buy-cta-hint">
          {DISABLED_HINT}
        </Text>
      </YStack>
    );
  }

  return (
    <Button
      label={BUTTON_LABEL}
      variant="primary"
      size="lg"
      onPress={() => {
        void opener(url);
      }}
      accessibilityLabel={ENABLED_A11Y_LABEL}
      aria-label={ENABLED_A11Y_LABEL}
      testID="buy-cta-button"
    />
  );
}

/**
 * Open the given TCGplayer affiliate URL using
 * `expo-web-browser`'s in-app browser. Falls back to
 * `Linking.openURL` when the in-app browser throws (e.g. on a
 * device with no Chrome custom-tabs provider installed).
 *
 * Exported so the mobile component's tests can assert it forwards
 * to the right Expo surface, and so future callers (e.g. a price
 * widget that wants its own "Buy" affordance) can share the same
 * opener.
 */
export async function openTcgplayerUrl(url: string): Promise<void> {
  try {
    await WebBrowser.openBrowserAsync(url);
    return;
  } catch {
    // Intentional: log to a metric in the future; for now the
    // fallback below is the only reasonable recovery.
  }
  try {
    await Linking.openURL(url);
  } catch {
    // Last-resort silent no-op. Users will see no browser open;
    // an upstream telemetry pass (post-MVP) can promote this to a
    // user-visible toast.
  }
}
