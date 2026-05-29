// `apps/mobile/src/grading/capture` — public barrel.
//
// Consumers (today: route file under `app/(tabs)/grading.tsx`;
// tomorrow: T-GR-CENTERING for the {@link GradingCaptureSession}
// shape) import from here. Internal modules import their
// neighbours via relative paths so the barrel does not become a
// circular-import hub.

export {
  CAPTURE_BRIGHTNESS_MAX,
  CAPTURE_BRIGHTNESS_MIN,
  CAPTURE_CORNER_COVERAGE_MIN,
  CAPTURE_COVERAGE_ACTIVITY_RATIO,
  CAPTURE_COVERAGE_MIN_BY_KIND,
  CAPTURE_FULL_COVERAGE_MIN,
  CAPTURE_GRID_HEIGHT,
  CAPTURE_GRID_WIDTH,
  CAPTURE_KINDS,
  CAPTURE_REVIEW_ROUTE,
  CAPTURE_SHARPNESS_MIN,
  CAPTURE_STEP_COUNT,
  CAPTURE_STEPS,
  CAPTURE_SURFACE_BRIGHTNESS_MIN,
} from './constants.js';

export type {
  CaptureFeedbackReason,
  CaptureOverlayKind,
  CaptureQualityMetrics,
  CaptureQualityResult,
  CaptureSessionState,
  CaptureStepDefinition,
  GradingCaptureSession,
  GradingShot,
  GradingShotKind,
} from './types.js';

export {
  CAPTURE_FEEDBACK_COPY,
  evaluateCaptureQuality,
  evaluateCaptureQualityForKind,
  evaluateCaptureQualityForStep,
  gateOptionsForStep,
} from './quality.js';
export type { QualityEvaluationOptions } from './quality.js';

export {
  buildEmittedSession,
  createInitialSessionState,
  currentStep,
  isComplete,
  reduceCaptureSession,
} from './session.js';
export type { CaptureSessionAction } from './session.js';

export {
  buildCaptureQualityEvent,
  CAPTURE_FRAME_MIN_INTERVAL_MS,
  createCaptureQualitySink,
  createCaptureThrottleState,
  shouldEmitCaptureFrame,
  useCaptureFrameProcessor,
} from './frame-processor.js';
export type {
  CaptureFrameLike,
  CaptureQualityEvent,
  CaptureQualityListener,
  CaptureQualitySink,
  CaptureThrottleState,
  UseCaptureFrameProcessorOptions,
} from './frame-processor.js';

export { deriveCaptureButtonState } from './capture-button.js';
export type {
  CaptureButtonState,
  DeriveCaptureButtonStateInput,
} from './capture-button.js';

export {
  evaluateAttemptFromPixels,
  useCameraPermissionFlow,
  useCaptureSession,
} from './use-capture-session.js';
export type {
  CameraPermissionFlow,
  CaptureAttempt,
  CaptureAttemptInput,
  UseCaptureSessionOptions,
  UseCaptureSessionResult,
} from './use-capture-session.js';

export { CaptureControls } from './components/CaptureControls.js';
export type { CaptureControlsProps } from './components/CaptureControls.js';

export { CaptureFeedbackBanner } from './components/CaptureFeedbackBanner.js';
export type { CaptureFeedbackBannerProps } from './components/CaptureFeedbackBanner.js';

export { CaptureFramingOverlay } from './components/CaptureFramingOverlay.js';
export type { CaptureFramingOverlayProps } from './components/CaptureFramingOverlay.js';

export { CaptureReviewModal } from './components/CaptureReviewModal.js';
export type { CaptureReviewModalProps } from './components/CaptureReviewModal.js';

export { CaptureStepIndicator } from './components/CaptureStepIndicator.js';
export type { CaptureStepIndicatorProps } from './components/CaptureStepIndicator.js';

export { GradingCameraSurface } from './components/GradingCameraSurface.js';
export type { GradingCameraSurfaceProps } from './components/GradingCameraSurface.js';

export {
  __getLastEmittedSession,
  __setLastEmittedSession,
  GradingCaptureScreen,
} from './screens/GradingCaptureScreen.js';
export type { GradingCaptureScreenProps } from './screens/GradingCaptureScreen.js';

export { GradingCaptureReviewScreen } from './screens/GradingCaptureReviewScreen.js';
export type { GradingCaptureReviewScreenProps } from './screens/GradingCaptureReviewScreen.js';
