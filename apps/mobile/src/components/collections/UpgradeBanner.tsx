// `<UpgradeBanner>` — the consistent paywall surface for paid-only
// custom + smart-collection features.
//
// Rendered in three places:
//
//   - Above the empty smart-collections list for free users.
//   - Below the disabled "Save" button on the smart editor when the
//     user is on free.
//   - On the smart-detail screen when a user without a paid plan
//     deeplinks to a smart collection (defensive — the server's
//     RLS already gates this, but we want a friendly message
//     rather than a raw 403).
//
// The CTA is intentionally a no-op for v1: T-M-PAYMENTS owns the
// upgrade flow, and we don't want to half-build a deep link this
// task can't support. The button captures the intent (testable)
// and the screen owner wires it up later.

import { Button, Card, Text, YStack } from '@binderly/ui';

import type { ReactNode } from 'react';


export interface UpgradeBannerProps {
  /** Headline above the body (defaults to a generic "paid plan required"). */
  readonly title?: string;
  /** Body copy below the headline. Defaults to a generic upsell line. */
  readonly description?: string;
  /** Press handler for the CTA. Defaults to a no-op (T-M-PAYMENTS owns the flow). */
  readonly onUpgrade?: () => void;
  /** Test id (defaults to `collections-upgrade-banner`). */
  readonly testID?: string;
}

const DEFAULT_TITLE = 'Upgrade to save smart collections';
const DEFAULT_DESCRIPTION =
  'Saving and re-running smart collections is part of the Pro plan. Free users can still try the smart query editor.';

export function UpgradeBanner(props: UpgradeBannerProps): ReactNode {
  const testID = props.testID ?? 'collections-upgrade-banner';
  const title = props.title ?? DEFAULT_TITLE;
  const description = props.description ?? DEFAULT_DESCRIPTION;
  return (
    <Card
      variant="outlined"
      gap="$3"
      padding="$4"
      margin="$4"
      backgroundColor="$surfaceMuted"
      testID={testID}
    >
      <YStack gap="$2">
        <Text variant="subtitle" tone="default">
          {title}
        </Text>
        <Text variant="body" tone="muted">
          {description}
        </Text>
      </YStack>
      <Button
        label="Upgrade"
        variant="primary"
        size="md"
        onPress={props.onUpgrade}
        accessibilityLabel="Upgrade"
        testID={`${testID}-cta`}
      />
    </Card>
  );
}
