// Debug-only FPS overlay.
//
// Reads from the {@link FrameTelemetrySink} and renders a small
// pill showing the sliding-window FPS estimate. The badge is gated
// on a `visible` prop (typically wired to `__DEV__`) so production
// builds don't accidentally surface it.
//
// Updates are throttled by {@link FPS_BADGE_UPDATE_INTERVAL_MS} —
// the sink itself notifies on every frame, but re-rendering a tiny
// pill at 10 FPS is wasteful when 2 FPS reads the same.

import { type ReactNode, useEffect, useState } from 'react';

import { Text, YStack } from '@binderly/ui';

import { FPS_BADGE_UPDATE_INTERVAL_MS } from '../constants.js';

import type { FrameTelemetrySink } from '../types.js';

export interface FpsDebugBadgeProps {
  /** Telemetry sink the badge subscribes to. */
  readonly sink: FrameTelemetrySink;
  /** Hide the badge entirely when false. Defaults to false. */
  readonly visible?: boolean;
  /** Override the test id (defaults to `'fps-debug-badge'`). */
  readonly testID?: string;
}

export function FpsDebugBadge(props: FpsDebugBadgeProps): ReactNode {
  const { sink, visible = false } = props;
  const [fps, setFps] = useState<number | null>(() => sink.fps());

  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => {
      setFps(sink.fps());
    }, FPS_BADGE_UPDATE_INTERVAL_MS);
    return (): void => {
      clearInterval(id);
    };
  }, [visible, sink]);

  if (!visible) return null;

  const label = fps === null ? '— FPS' : `${fps.toFixed(1)} FPS`;

  return (
    <YStack
      paddingHorizontal="$3"
      paddingVertical="$1"
      borderRadius={6}
      backgroundColor="$background"
      borderWidth={1}
      borderColor="$border"
      testID={props.testID ?? 'fps-debug-badge'}
    >
      <Text variant="caption" tone="muted">
        {label}
      </Text>
    </YStack>
  );
}
