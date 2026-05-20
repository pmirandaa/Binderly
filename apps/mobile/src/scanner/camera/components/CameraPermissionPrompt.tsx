// Pre-prompt screen — shown before the OS permission dialog.
//
// `rules/06-scanner.md` asks for "a gentle pre-prompt screen
// explaining why before the OS dialog". The branches we render:
//
//   - `not-determined` — friendly explanation + "Allow camera" CTA
//     that triggers the OS dialog. First-launch path.
//   - `denied` — explanation that the user previously declined,
//     with an "Open Settings" CTA that deep-links to the system
//     Settings app. We can't re-prompt programmatically after a
//     cached denial.
//   - `restricted` — non-actionable explanation (parental controls,
//     MDM).
//
// The component never assumes `'granted'` — ScanScreen filters
// that branch out before mounting this prompt.

import { type ReactNode, useCallback } from 'react';

import { Button, Text, YStack } from '@binderly/ui';

import type { CameraPermissionFlowStatus } from '../permissions.js';

export interface CameraPermissionPromptProps {
  /** Current permission status. */
  readonly status: CameraPermissionFlowStatus;
  /** Trigger the OS permission dialog. */
  readonly onRequestPermission: () => Promise<unknown> | void;
  /** Open the system Settings deep link. */
  readonly onOpenSettings: () => Promise<unknown> | void;
  /** Bail out of the scan flow entirely (e.g. tab navigate away). */
  readonly onCancel?: () => void;
  /** Override the test id (defaults to `'camera-permission-prompt'`). */
  readonly testID?: string;
}

interface BranchCopy {
  readonly title: string;
  readonly body: string;
  readonly primaryLabel: string | null;
  readonly primaryAction: 'request' | 'settings' | null;
}

const COPY: Record<CameraPermissionFlowStatus, BranchCopy> = {
  granted: {
    title: 'Camera ready',
    body: 'You can scan cards.',
    primaryLabel: null,
    primaryAction: null,
  },
  'not-determined': {
    title: 'Scan your cards with the camera',
    body:
      'Binderly uses your camera to recognise cards and add them to your collection. Card images stay on your phone — they never leave the device.',
    primaryLabel: 'Allow camera',
    primaryAction: 'request',
  },
  denied: {
    title: 'Camera access is turned off',
    body:
      'Binderly can’t scan cards without camera access. Open Settings, find Binderly under app permissions, and turn the camera switch on.',
    primaryLabel: 'Open Settings',
    primaryAction: 'settings',
  },
  restricted: {
    title: 'Camera access is restricted',
    body:
      'Camera access is blocked by your device’s parental controls or device management. You can still browse your collection and add cards manually.',
    primaryLabel: null,
    primaryAction: null,
  },
};

export function CameraPermissionPrompt(props: CameraPermissionPromptProps): ReactNode {
  const copy = COPY[props.status];

  const handlePrimary = useCallback(() => {
    if (copy.primaryAction === 'request') {
      void props.onRequestPermission();
    } else if (copy.primaryAction === 'settings') {
      void props.onOpenSettings();
    }
  }, [copy.primaryAction, props]);

  return (
    <YStack
      flex={1}
      gap="$4"
      padding="$6"
      alignItems="center"
      justifyContent="center"
      backgroundColor="$background"
      testID={props.testID ?? 'camera-permission-prompt'}
    >
      <Text variant="title" tone="default">
        {copy.title}
      </Text>
      <Text variant="body" tone="muted">
        {copy.body}
      </Text>
      {copy.primaryLabel !== null ? (
        <Button
          variant="primary"
          onPress={handlePrimary}
          testID="camera-permission-primary"
        >
          {copy.primaryLabel}
        </Button>
      ) : null}
      {props.onCancel !== undefined ? (
        <Button
          variant="ghost"
          onPress={props.onCancel}
          testID="camera-permission-cancel"
        >
          Not now
        </Button>
      ) : null}
    </YStack>
  );
}
