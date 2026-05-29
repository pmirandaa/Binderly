// `<ScanModeToggle>` — segmented Single / Stack control for the scanner
// top bar (FU-57).
//
// Two segments:
//   - "Single"  → free single-card-scan mode (always available).
//   - "Stack"   → Pro continuous/stack scanner. When `stackLocked` is
//                 true (free user) the segment label reads "Stack · Pro"
//                 and tapping it still fires `onSelect('continuous')` so
//                 the screen can route to the upgrade prompt.
//
// The component is pure: it renders the current selection + surfaces the
// requested mode via `onSelect`. The screen owns the gate decision and
// what a locked tap does.

import { type ReactNode } from 'react';

import { Button, XStack } from '@binderly/ui';

import type { ScanMode } from './types.js';

export interface ScanModeToggleProps {
  /** Currently active mode. */
  readonly mode: ScanMode;
  /**
   * `true` when the user can't access the continuous/stack mode (free
   * tier). The stack segment reads "Stack · Pro"; tapping it still calls
   * `onSelect('continuous')` so the screen can show the upsell.
   */
  readonly stackLocked: boolean;
  /** Called with the requested mode when a segment is tapped. */
  onSelect(mode: ScanMode): void;
  readonly testID?: string;
}

export function ScanModeToggle(props: ScanModeToggleProps): ReactNode {
  const { mode, stackLocked, onSelect, testID } = props;

  return (
    <XStack
      backgroundColor="$backgroundStrong"
      borderRadius={999}
      padding="$1"
      gap="$1"
      alignItems="center"
      testID={testID ?? 'scan-mode-toggle'}
    >
      <Button
        variant={mode === 'single' ? 'primary' : 'ghost'}
        size="sm"
        label="Single"
        onPress={() => onSelect('single')}
        testID="scan-mode-toggle-single"
        accessibilityLabel="Single card scan mode"
      />
      <Button
        variant={mode === 'continuous' ? 'primary' : 'ghost'}
        size="sm"
        label={stackLocked ? 'Stack · Pro' : 'Stack'}
        onPress={() => onSelect('continuous')}
        testID="scan-mode-toggle-stack"
        accessibilityLabel={
          stackLocked ? 'Stack scan mode, Pro feature' : 'Stack scan mode'
        }
      />
    </XStack>
  );
}
