// Public surface of the on-device embedding module.
//
// The scanner screen wires `loadEmbeddingModel` once on mount, holds
// the returned handle, and calls `handle.embed(frame)` from the
// vision-camera frame processor (via `runOnJS`).
//
// `T-SC-MATCH` subscribes to `embedTelemetry` for per-frame latency.

export { loadEmbeddingModel, EmbeddingLoadError } from './loader';
export type { LoadEmbeddingModelOptions } from './loader';
export {
  EmbeddingManifestSchema,
  parseManifest,
  type EmbeddingManifest,
  type PreprocessingName,
} from './manifest';
export {
  embedTelemetry,
  createEmbedTelemetry,
  type EmbedTelemetryEmitter,
  type EmbedTelemetryListener,
} from './telemetry';
export type {
  EmbedFrameInput,
  EmbedTelemetryEvent,
  EmbeddingModelHandle,
  InferenceDelegate,
} from './types';
export {
  preprocessFrame,
  preprocessFromFrame,
  postprocessEmbedding,
  l2Normalize,
} from './embed';
