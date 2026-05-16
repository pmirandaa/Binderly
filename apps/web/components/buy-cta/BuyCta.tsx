'use client';

// `<BuyCta>` (web) — affiliate "Buy on TCGplayer" call-to-action.
//
// Wraps `@binderly/ui`'s `<Button>` inside a real `<a>` so middle-
// click / "open in new tab" / accessibility tools all behave like
// any other external link. When the affiliate id is missing (no
// `NEXT_PUBLIC_TCGPLAYER_AFFILIATE_ID` env var) the button degrades
// to a disabled "Coming soon" state with a tooltip — matching the
// existing `<CardView>` "card-add-tooltip" pattern.
//
// The component owns no env-loading logic itself: callers may pass
// an explicit `affiliateId` (used by tests + Storybook) and the
// default reads from `process.env` at render time. Next.js inlines
// `NEXT_PUBLIC_*` vars at build time so this is safe in RSC + client
// bundles alike.

import { Button } from '@binderly/ui';

import {
  WEB_TCGPLAYER_AFFILIATE_ID_ENV,
  buildTcgplayerUrl,
  type TcgplayerCardIdentifier,
} from '../../lib/affiliate';

import type { ReactNode } from 'react';

const BUTTON_LABEL = 'Buy on TCGplayer';
const DISABLED_TOOLTIP = 'Coming soon';
const DISABLED_ARIA_LABEL = 'Buy on TCGplayer — coming soon';

export interface BuyCtaProps {
  /** Card identifier used to build the TCGplayer search URL. */
  readonly card: TcgplayerCardIdentifier;
  /**
   * Explicit affiliate id override. Production callers leave this
   * unset and the component reads `NEXT_PUBLIC_TCGPLAYER_AFFILIATE_ID`
   * from `process.env`. Tests pass an explicit value.
   */
  readonly affiliateId?: string | null;
  /**
   * Test seam — lets tests assert the URL builder is called with
   * the exact card shape without monkey-patching the module.
   */
  readonly buildUrl?: typeof buildTcgplayerUrl;
}

export function BuyCta(props: BuyCtaProps): ReactNode {
  const builder = props.buildUrl ?? buildTcgplayerUrl;
  const affiliateId =
    props.affiliateId === undefined ? readAffiliateIdFromProcess() : props.affiliateId;
  const url = builder(props.card, { affiliateId });

  if (url === null) {
    return (
      <span title={DISABLED_TOOLTIP} data-testid="buy-cta-tooltip" data-state="disabled">
        <Button
          label={BUTTON_LABEL}
          disabled
          variant="primary"
          data-testid="buy-cta-button"
          aria-label={DISABLED_ARIA_LABEL}
        />
      </span>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer sponsored"
      data-testid="buy-cta-link"
      data-state="enabled"
      style={{ textDecoration: 'none', display: 'inline-block' }}
    >
      <Button
        label={BUTTON_LABEL}
        variant="primary"
        data-testid="buy-cta-button"
        aria-label={`${BUTTON_LABEL} (opens in a new tab)`}
      />
    </a>
  );
}

function readAffiliateIdFromProcess(): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const value = proc?.env?.[WEB_TCGPLAYER_AFFILIATE_ID_ENV];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
