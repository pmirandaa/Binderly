// `<GradingCaptureScreen>` — the guided multi-shot capture flow
// (the full PROJECT.md § 12 set: front, back, four corners, surface).
//
// Composes the smaller pieces in this tree:
//
//   - `useCaptureSession()` for the session reducer + hook surface.
//   - `useCameraPermissionFlow()` (re-exported from scanner) for
//     the OS-level camera permission state. We never render the
//     camera surface unless `status === 'granted'`.
//   - `<CameraPermissionPrompt>` (re-used from the scanner barrel
//     per the hard constraint — we do NOT re-implement permission
//     copy in this tree).
//   - `<GradingCameraSurface>` for the live preview + framing
//     overlay.
//   - `<CaptureStepIndicator>` for the 1..4 progress dots.
//   - `<CaptureFeedbackBanner>` for the most-recent reason.
//   - `<CaptureControls>` for capture / cancel / start-over.
//   - `<CaptureReviewModal>` for the post-capture accept / retake
//     sheet.
//
// The screen is intentionally thin — every interesting decision
// lives in the pure modules (`session.ts`, `quality.ts`,
// `use-capture-session.ts`) so the contract tests can pin them
// without rendering React.
//
// `attemptCapture` is dependency-injected via props so the
// vitest harness can drive the screen with deterministic stubs.
// The route file (`app/(tabs)/grading.tsx`) constructs the
// default that wires vision-camera's `takePhoto()` + a synthesised
// pass-through quality. See "Notes from execution" in the task
// brief for the wiring decision.

import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { Button, Text, XStack, YStack } from '@binderly/ui';

import { storeSession } from '../../../grading/centering/session-store.js';
import { CameraPermissionPrompt } from '../../../scanner/camera/index.js';
import { deriveCaptureButtonState } from '../capture-button.js';
import { CaptureControls } from '../components/CaptureControls.js';
import { CaptureFeedbackBanner } from '../components/CaptureFeedbackBanner.js';
import { CaptureReviewModal } from '../components/CaptureReviewModal.js';
import { CaptureStepIndicator } from '../components/CaptureStepIndicator.js';
import { GradingCameraSurface } from '../components/GradingCameraSurface.js';
import { createCaptureQualitySink, useCaptureFrameProcessor } from '../frame-processor.js';
import { gateOptionsForStep } from '../quality.js';
import {
  useCameraPermissionFlow,
  useCaptureSession,
  type CaptureAttempt,
  type CaptureAttemptInput,
} from '../use-capture-session.js';

import type { QualityEvaluationOptions } from '../quality.js';
import type {
  CaptureQualityResult,
  GradingCaptureSession,
  GradingShot,
  GradingShotKind,
} from '../types.js';
import type { Camera } from 'react-native-vision-camera';

/** The centering route path — the destination after a completed capture. */
const CENTERING_ROUTE_BASE = '/grading/centering';

/**
 * Placeholder session-handoff — kept for one release cycle so no external
 * caller breaks.  Replaced by `storeSession` from the centering barrel.
 *
 * @deprecated Use `storeSession` + `getSession` from
 * `apps/mobile/src/grading/centering/session-store.ts` instead.
 * The route now passes `?sessionId=<id>` and the centering screen reads
 * from the module-scoped store.  This shim will be removed in a follow-up.
 */
let _legacyLastSession: GradingCaptureSession | null = null;
/** @deprecated See `storeSession` in the centering module. */
export function __setLastEmittedSession(session: GradingCaptureSession | null): void {
  _legacyLastSession = session;
}
/** @deprecated See `getSession` in the centering module. */
export function __getLastEmittedSession(): GradingCaptureSession | null {
  return _legacyLastSession;
}

export interface GradingCaptureScreenProps {
  /**
   * Run the capture attempt. Defaults to a stub that always
   * returns a synthetic "no card detected" rejection — the real
   * frame-processor + `takePhoto()` wiring lands in a follow-up
   * (see task brief Notes from execution).
   */
  readonly attemptCapture?: () => Promise<CaptureAttemptInput>;
  /** Override the testID (defaults to `'grading-capture-screen'`). */
  readonly testID?: string;
}

export function GradingCaptureScreen(props: GradingCaptureScreenProps): ReactNode {
  const router = useRouter();
  const permission = useCameraPermissionFlow();
  const cameraRef = useRef<Camera | null>(null);

  const defaultAttempt = useCallback<() => Promise<CaptureAttemptInput>>(async () => {
    return {
      outcome: 'rejected',
      quality: {
        metrics: { sharpness: 0, brightness: 0, coverage: 0 },
        sharpnessOK: false,
        brightnessOK: false,
        coverageOK: false,
        accepted: false,
        reason: 'no_card_detected',
      },
    };
  }, []);

  const attemptCapture = props.attemptCapture ?? defaultAttempt;

  const session = useCaptureSession({ attemptCapture });

  const [busy, setBusy] = useState<boolean>(false);
  const [pendingShot, setPendingShot] = useState<{
    readonly shot: GradingShot;
    readonly stepTitle: string;
  } | null>(null);

  const acceptedKinds = useMemo<ReadonlySet<GradingShotKind>>(
    () => new Set<GradingShotKind>(Object.keys(session.state.shots) as GradingShotKind[]),
    [session.state.shots],
  );

  // --- live quality (#FU-33) ----------------------------------------
  // A JS-side bus the optional frame-processor worklet feeds. In tests
  // / no-camera runtimes the worklet never fires, so `liveQuality`
  // stays null and the capture button keeps its tap-driven behaviour.
  const captureQualitySink = useMemo(() => createCaptureQualitySink(), []);
  const activeGate = useMemo<QualityEvaluationOptions>(
    () => gateOptionsForStep(session.step ?? session.steps[0]!),
    [session.step, session.steps],
  );
  const frameProcessor = useCaptureFrameProcessor({
    sink: captureQualitySink,
    gate: activeGate,
  });
  const [liveQuality, setLiveQuality] = useState<CaptureQualityResult | null>(null);

  useEffect(() => {
    const unsubscribe = captureQualitySink.subscribe((event): void => {
      setLiveQuality(event.quality);
    });
    return unsubscribe;
  }, [captureQualitySink]);

  // Drop a stale live sample when the step advances so the previous
  // shot's quality doesn't bleed into the next step's button state.
  useEffect((): void => {
    captureQualitySink.clear();
    setLiveQuality(null);
  }, [captureQualitySink, session.state.stepIndex]);

  const handleCapture = useCallback(async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const attempt: CaptureAttempt = await session.attemptCapture();
      if (attempt.outcome === 'rejected') {
        return;
      }
      setPendingShot({
        shot: attempt.shot,
        stepTitle: session.step?.title ?? 'Captured',
      });
    } finally {
      setBusy(false);
    }
  }, [busy, session]);

  const handleAcceptPending = useCallback((): void => {
    if (pendingShot === null) return;
    session.acceptShot(pendingShot.shot);
    setPendingShot(null);
    // Completion-driven navigation is handled in the effect below
    // — that fires on the render after the reducer commits, so
    // `session.emitSession()` reads the fresh state instead of
    // the stale closure we'd have here.
  }, [pendingShot, session]);

  // Effect-driven completion navigation. Pushes to the review
  // route exactly once when `isComplete` flips to `true`. The
  // `navigatedRef` guard handles React 18's StrictMode double-
  // invocation of effects in dev.
  const navigatedRef = useRef<boolean>(false);
  useEffect((): void => {
    if (!session.state.isComplete) {
      navigatedRef.current = false;
      return;
    }
    if (navigatedRef.current) return;
    const emitted = session.emitSession();
    if (emitted === null) return;
    navigatedRef.current = true;
    // Store the session in the centering module's registry so the centering
    // screen can retrieve it by id without URL-encoding 4 file URIs.
    storeSession(emitted);
    // Keep the legacy shim populated for any caller still using it.
    __setLastEmittedSession(emitted);
    router.push(`${CENTERING_ROUTE_BASE}?sessionId=${encodeURIComponent(emitted.id)}`);
  }, [router, session, session.state.isComplete]);

  const handleRetakePending = useCallback((): void => {
    setPendingShot(null);
  }, []);

  const handleCancel = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  }, [router]);

  const handleReset = useCallback((): void => {
    setPendingShot(null);
    session.resetSession();
  }, [session]);

  if (permission.status !== 'granted') {
    return (
      <YStack
        flex={1}
        backgroundColor="$background"
        testID={props.testID ?? 'grading-capture-screen'}
      >
        <CaptureHeader onCancel={handleCancel} />
        <CameraPermissionPrompt
          status={permission.status}
          onRequestPermission={permission.requestPermission}
          onOpenSettings={permission.openSettings}
        />
      </YStack>
    );
  }

  const activeStep = session.step;
  const showReset = Object.keys(session.state.shots).length > 0 && !session.state.isComplete;
  const buttonState = deriveCaptureButtonState({
    liveQuality,
    sessionComplete: activeStep === null,
    busy,
  });

  return (
    <YStack
      flex={1}
      backgroundColor="$background"
      testID={props.testID ?? 'grading-capture-screen'}
    >
      <YStack
        padding="$3"
        gap="$3"
        alignItems="center"
        backgroundColor="$background"
      >
        <CaptureStepIndicator
          steps={session.steps}
          currentIndex={session.state.stepIndex}
          acceptedKinds={acceptedKinds}
        />
        {activeStep !== null ? (
          <YStack alignItems="center" gap="$1" testID="capture-active-step">
            <Text variant="subtitle" tone="default">
              {activeStep.title}
            </Text>
            <Text variant="bodySmall" tone="muted">
              {activeStep.instruction}
            </Text>
          </YStack>
        ) : (
          <YStack alignItems="center" gap="$1" testID="capture-complete-banner">
            <Text variant="subtitle" tone="success">
              All shots captured
            </Text>
            <Text variant="bodySmall" tone="muted">
              Preparing the grading review…
            </Text>
          </YStack>
        )}
      </YStack>

      {activeStep !== null ? (
        <GradingCameraSurface
          isActive={pendingShot === null}
          cameraRef={cameraRef}
          overlayKind={activeStep.overlay}
          overlayHint={activeStep.title}
          frameProcessor={frameProcessor}
        />
      ) : (
        <YStack
          flex={1}
          alignItems="center"
          justifyContent="center"
          padding="$6"
          testID="capture-done-placeholder"
        >
          <Text variant="body" tone="muted">
            Tap continue on the next screen to review your shots.
          </Text>
        </YStack>
      )}

      <YStack
        padding="$3"
        gap="$3"
        backgroundColor="$background"
        testID="capture-bottom-bar"
      >
        <CaptureFeedbackBanner
          reason={session.state.lastReason ?? buttonState.liveReason}
          defaultsToReady
        />
        <CaptureControls
          captureLabel={buttonState.label}
          captureDisabled={buttonState.disabled}
          captureBusy={busy}
          onCapture={handleCapture}
          onCancel={handleCancel}
          showReset={showReset}
          onReset={handleReset}
        />
      </YStack>

      <CaptureReviewModal
        visible={pendingShot !== null}
        stepTitle={pendingShot?.stepTitle ?? ''}
        photoUri={pendingShot?.shot.uri ?? ''}
        sharpness={pendingShot?.shot.quality.metrics.sharpness ?? 0}
        brightness={pendingShot?.shot.quality.metrics.brightness ?? 0}
        coverage={pendingShot?.shot.quality.metrics.coverage ?? 0}
        onAccept={handleAcceptPending}
        onRetake={handleRetakePending}
      />
    </YStack>
  );
}

interface CaptureHeaderProps {
  readonly onCancel: () => void;
}

function CaptureHeader(props: CaptureHeaderProps): ReactNode {
  return (
    <XStack
      padding="$3"
      justifyContent="flex-start"
      alignItems="center"
      backgroundColor="$background"
    >
      <Button variant="ghost" onPress={props.onCancel} testID="grading-capture-close">
        Close
      </Button>
    </XStack>
  );
}
