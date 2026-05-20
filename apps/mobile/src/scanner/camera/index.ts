// `apps/mobile/src/scanner/camera` — public barrel.
//
// The barrel intentionally re-exports only the surfaces other
// scanner-stage tasks dock onto:
//
//   - T-SC-DETECT will swap the `processFrame()` worklet for a
//     real detection implementation; the throttle + telemetry
//     bridge stay the same.
//   - T-SC-MATCH consumes the {@link StackModeSignal} so the
//     session counter resets correctly between cards.
//   - T-SC-UX builds the continuous-add UX on top of
//     {@link CameraPreview} + the telemetry sink subscription.
//
// External-to-mobile consumers (web, packages) do **not** import
// from this barrel — scanner code only runs on the device.

export {
  FPS_BADGE_UPDATE_INTERVAL_MS,
  FRAME_PROCESSOR_MIN_INTERVAL_MS,
  FRAME_TELEMETRY_RING_SIZE,
  STACK_MODE_RESET_WINDOW_MS,
  STACK_MODE_RING_SIZE,
  TARGET_FRAME_RATE_FPS,
} from './constants.js';

export type {
  FrameTelemetryEvent,
  FrameTelemetryListener,
  FrameTelemetrySink,
  FrameTelemetrySnapshot,
  StackModeSignal,
} from './types.js';

export { createRingBuffer } from './ring-buffer.js';
export type { RingBuffer } from './ring-buffer.js';

export { createFrameTelemetrySink } from './frame-telemetry.js';

export { createStackModeDetector } from './stack-mode.js';
export type { StackModeDetector } from './stack-mode.js';

export { useCameraPermissionFlow } from './permissions.js';
export type {
  CameraPermissionFlow,
  CameraPermissionFlowStatus,
} from './permissions.js';

export { useCameraActive } from './camera-lifecycle.js';
export type { UseCameraActiveOptions } from './camera-lifecycle.js';

export {
  buildFrameTelemetryEvent,
  createFrameThrottleState,
  processFrame,
  shouldEmitFrame,
  useScanFrameProcessor,
} from './frame-processor.js';
export type {
  FrameLike,
  FrameThrottleState,
  ScanFrameProcessorOptions,
} from './frame-processor.js';

export { CameraPermissionPrompt } from './components/CameraPermissionPrompt.js';
export type { CameraPermissionPromptProps } from './components/CameraPermissionPrompt.js';

export { CameraPreview } from './components/CameraPreview.js';
export type { CameraPreviewProps } from './components/CameraPreview.js';

export { FpsDebugBadge } from './components/FpsDebugBadge.js';
export type { FpsDebugBadgeProps } from './components/FpsDebugBadge.js';
