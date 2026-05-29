// `<CardThumbnail>` — small card-image tile shared by `<MatchOverlay>`
// and `<DisambigPicker>` (FU-34).
//
// Renders the matched printing's thumbnail when a URL is available,
// degrading gracefully to a coloured placeholder box in three cases:
//
//   1. no URL yet (catalog lookup still loading / printing has no image),
//   2. the image failed to decode (`onError`),
//   3. an empty-string URL.
//
// The component is pure: it takes a resolved URL string (or null) as a
// prop. The catalog lookup that produces the URL lives in the screen
// layer (`screens/scan/use-printing.ts`) so this `scanner/ui/` tree
// stays free of any `@binderly/api-client` import — enforced by the
// `network-isolation` test in this folder.

import { Image } from 'expo-image';
import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';

import { Text, YStack } from '@binderly/ui';

const styles = StyleSheet.create({
  image: { width: '100%', height: '100%' },
});

export interface CardThumbnailProps {
  /**
   * Resolved thumbnail URL. `null` / `undefined` / empty string all
   * render the placeholder. A non-empty URL renders the image and
   * falls back to the placeholder if the image fails to load.
   */
  readonly url?: string | null;
  /**
   * Short placeholder label (e.g. a collector number or the printing
   * id) shown inside the box while there's no image. Trimmed to the
   * first few characters so it fits the small tile.
   */
  readonly label?: string;
  /** Tile width in px. Height is derived from the 5:7 card aspect. */
  readonly width?: number;
  readonly testID?: string;
}

const DEFAULT_WIDTH = 44;
/** Standard trading-card aspect ratio (width:height). */
const CARD_ASPECT = 5 / 7;

export function CardThumbnail(props: CardThumbnailProps): ReactNode {
  const { url, label, width = DEFAULT_WIDTH, testID } = props;
  const baseTestID = testID ?? 'card-thumbnail';

  const [errored, setErrored] = useState(false);

  // A changed URL gets a fresh chance to load — reset the error latch
  // whenever the source changes.
  useEffect(() => {
    setErrored(false);
  }, [url]);

  const hasUrl = typeof url === 'string' && url.length > 0;
  const showImage = hasUrl && !errored;

  return (
    <YStack
      width={width}
      aspectRatio={CARD_ASPECT}
      backgroundColor="$surfaceMuted"
      borderRadius="$2"
      alignItems="center"
      justifyContent="center"
      overflow="hidden"
      testID={baseTestID}
    >
      {showImage ? (
        <Image
          source={{ uri: url as string }}
          style={styles.image}
          contentFit="contain"
          onError={() => setErrored(true)}
          testID={`${baseTestID}-image`}
          accessibilityLabel={
            label !== undefined && label.length > 0
              ? `Card thumbnail: ${label}`
              : 'Card thumbnail'
          }
        />
      ) : (
        <Text variant="caption" tone="muted" testID={`${baseTestID}-placeholder`}>
          {label !== undefined && label.length > 0 ? label.slice(0, 4) : '—'}
        </Text>
      )}
    </YStack>
  );
}
