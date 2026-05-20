// `apps/mobile/src/scanner/detect` — public barrel.
//
// T-SC-MATCH and any future scan-screen wiring import only
// from this barrel. We deliberately keep the surface small:
//
//   - `detectCard()` is the pure pipeline entry point. Worklet-safe.
//   - `useDetectFrameProcessor()` is the hook the scan screen
//     plugs into the `<Camera>` component's `frameProcessor` prop.
//   - `createDetectionSink()` is the JS-side bus the worklet
//     pushes events onto.
//
// Constants are exported because T-SC-MATCH may want to display
// them in a debug overlay (sharpness floor, brightness band, etc.)
// or surface them in a future scanner settings UI.

export {
  CARD_ASPECT_MAX,
  CARD_ASPECT_MIN,
  CARD_ASPECT_TARGET,
  CROP_TENSOR_SIZE,
  DETECT_GRID_HEIGHT,
  DETECT_GRID_WIDTH,
  QUALITY_BRIGHTNESS_MAX,
  QUALITY_BRIGHTNESS_MIN,
  QUALITY_SHARPNESS_MIN,
  RECT_ACTIVITY_FLOOR,
  RECT_ACTIVITY_THRESHOLD_RATIO,
} from './constants.js';

export type {
  DetectFrameLike,
  DetectionEvent,
  DetectionInput,
  DetectionListener,
  DetectionResult,
  DetectionSink,
  QualityMetrics,
  Rect,
} from './types.js';

export { detectCard, type DetectCardOptions } from './detect.js';

export { createDetectionSink } from './detect-sink.js';

export {
  buildDetectionEvent,
  createDetectThrottleState,
  DETECT_FRAME_MIN_INTERVAL_MS,
  shouldEmitDetectFrame,
  useDetectFrameProcessor,
} from './frame-processor.js';
export type {
  DetectThrottleState,
  UseDetectFrameProcessorOptions,
} from './frame-processor.js';

// Pure helpers exported so adjacent layers (debug overlays,
// tests, future native fast-path) can re-use them. They're not
// part of the production scan-loop contract; importing from the
// barrel is fine.
export {
  computeGradientField,
  computeProjections,
  type ActivityProfiles,
  type GradientField,
} from './gradient.js';
export { downsampleGrayscale, rgbToGrayscale } from './grayscale.js';
export {
  findRectFromProjections,
  scaleRectToSource,
  ZERO_RECT,
  type RectDetection,
} from './rectangle.js';
export { computeQualityMetrics } from './quality.js';
export { cropAndNormalize, normalizeMobilenetV3 } from './crop.js';
