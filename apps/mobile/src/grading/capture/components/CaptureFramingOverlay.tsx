// Framing overlay — translucent shape rendered over the camera
// preview to guide the user's framing for each shot kind.
//
//   - `full-portrait`: large centered card-aspect rectangle. Used
//     for `frontFull` + `backFull`.
//   - `corner-top-left` / `corner-top-right` /
//     `corner-bottom-left` / `corner-bottom-right`: small squares
//     anchored to the matching corner. One per corner crop
//     (`frontCorner` / `backCorner` / `bottomLeftCorner` /
//     `bottomRightCorner`).
//   - `surface-raking`: a card-aspect rectangle plus a phone-tilt
//     indicator — surface raking-light shots are hard to capture,
//     so we coach the angle (per `rules/07-grading.md`).
//
// Real on-device behaviour wraps the overlay in a darkening mask
// (RN's `MaskedView` from `@react-native-masked-view/masked-view`)
// so the area **outside** the target frame is dimmed. We don't
// ship that mask in v1 — Tamagui doesn't expose it cross-platform
// without a new dep — but the rectangle borders + a translucent
// `$background` outside fill produce a usable guidance UI.
// The mask-style dimming is tracked as a polish follow-up.

import { type ReactNode } from 'react';

import { Text, YStack } from '@binderly/ui';

import type { CaptureOverlayKind } from '../types.js';

export interface CaptureFramingOverlayProps {
  readonly kind: CaptureOverlayKind;
  /** Optional sentence inside the frame ("Front of card", etc.). */
  readonly hint?: string;
  readonly testID?: string;
}

export function CaptureFramingOverlay(props: CaptureFramingOverlayProps): ReactNode {
  return (
    <YStack
      position="absolute"
      top={0}
      left={0}
      right={0}
      bottom={0}
      pointerEvents="none"
      testID={props.testID ?? `capture-framing-overlay-${props.kind}`}
      data-overlay-kind={props.kind}
    >
      {props.kind === 'full-portrait' ? (
        <FullPortraitFrame hint={props.hint} />
      ) : null}
      {props.kind === 'corner-top-left' ? (
        <CornerFrame hint={props.hint} corner="top-left" />
      ) : null}
      {props.kind === 'corner-top-right' ? (
        <CornerFrame hint={props.hint} corner="top-right" />
      ) : null}
      {props.kind === 'corner-bottom-left' ? (
        <CornerFrame hint={props.hint} corner="bottom-left" />
      ) : null}
      {props.kind === 'corner-bottom-right' ? (
        <CornerFrame hint={props.hint} corner="bottom-right" />
      ) : null}
      {props.kind === 'surface-raking' ? (
        <SurfaceRakingFrame hint={props.hint} />
      ) : null}
    </YStack>
  );
}

interface FullPortraitFrameProps {
  readonly hint?: string;
}

function FullPortraitFrame(props: FullPortraitFrameProps): ReactNode {
  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      padding="$4"
      testID="capture-framing-full"
    >
      <YStack
        width="75%"
        aspectRatio={2.5 / 3.5}
        borderRadius={12}
        borderWidth={3}
        borderColor="$primary"
        alignItems="center"
        justifyContent="flex-end"
        padding="$3"
      >
        {props.hint !== undefined ? (
          <Text variant="caption" tone="inverse">
            {props.hint}
          </Text>
        ) : null}
      </YStack>
    </YStack>
  );
}

type CornerAnchor = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

interface CornerFrameProps {
  readonly hint?: string;
  readonly corner: CornerAnchor;
}

function CornerFrame(props: CornerFrameProps): ReactNode {
  const isLeft = props.corner === 'top-left' || props.corner === 'bottom-left';
  const isTop = props.corner === 'top-left' || props.corner === 'top-right';
  const alignSelf = isLeft ? 'flex-start' : 'flex-end';
  const justifyContent = isTop ? 'flex-start' : 'flex-end';
  return (
    <YStack
      flex={1}
      padding="$6"
      justifyContent={justifyContent}
      testID={`capture-framing-corner-${props.corner}`}
    >
      <YStack
        alignSelf={alignSelf}
        width="40%"
        aspectRatio={1}
        borderRadius={8}
        borderWidth={3}
        borderColor="$primary"
        alignItems="center"
        justifyContent="flex-end"
        padding="$2"
      >
        {props.hint !== undefined ? (
          <Text variant="caption" tone="inverse">
            {props.hint}
          </Text>
        ) : null}
      </YStack>
    </YStack>
  );
}

interface SurfaceRakingFrameProps {
  readonly hint?: string;
}

function SurfaceRakingFrame(props: SurfaceRakingFrameProps): ReactNode {
  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      gap="$3"
      padding="$4"
      testID="capture-framing-surface"
    >
      <YStack
        width="75%"
        aspectRatio={2.5 / 3.5}
        borderRadius={12}
        borderWidth={3}
        borderColor="$primary"
        borderStyle="dashed"
        alignItems="center"
        justifyContent="flex-end"
        padding="$3"
      >
        {props.hint !== undefined ? (
          <Text variant="caption" tone="inverse">
            {props.hint}
          </Text>
        ) : null}
      </YStack>
      <YStack
        backgroundColor="$surfaceMuted"
        borderRadius={8}
        paddingHorizontal="$3"
        paddingVertical="$2"
        testID="capture-framing-surface-tilt"
      >
        <Text variant="caption" tone="muted">
          Tilt the phone so light rakes across the surface
        </Text>
      </YStack>
    </YStack>
  );
}
