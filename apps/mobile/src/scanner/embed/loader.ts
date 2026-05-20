// `loadEmbeddingModel` — on-device entry point.
//
// Responsibilities:
//   1. Resolve the bundled TFLite asset to a path the native binding
//      can `require()`.
//   2. Validate the manifest against `EmbeddingManifestSchema`.
//   3. Try the GPU delegate first (CoreML on iOS / OpenGL on Android);
//      fall back to CPU on any throw. Stage rule 06 mandates this.
//   4. Cross-check the loaded model's *actual* output length against
//      `manifest.embeddingDim`; reject on mismatch.
//   5. Return an `EmbeddingModelHandle` that runs end-to-end inference
//      + L2-normalisation and fires telemetry events.
//
// The native binding (`react-native-fast-tflite`) is imported through
// a tiny indirection (`./native`) so vitest can mock it. We deliberately
// keep the indirection minimal — one function, one re-export — so the
// runtime shape and the mock shape stay close.

import { ZodError } from 'zod';

import { postprocessEmbedding, preprocessFromFrame } from './embed';
import { EmbeddingManifestSchema, parseManifest } from './manifest';
import {
  loadTensorflowModel,
  type LoadedTensorflowModel,
  type TfliteDelegate,
} from './native';
import { embedTelemetry } from './telemetry';

import type { EmbeddingManifest } from './manifest';
import type { EmbedTelemetryEmitter } from './telemetry';
import type {
  EmbedFrameInput,
  EmbeddingModelHandle,
  InferenceDelegate,
} from './types';


/**
 * Typed failure modes the loader surfaces to the screen layer.
 *
 * The screen turns this into a localised "Scanner unavailable on this
 * device" toast. We carry the cause so Sentry can group failures.
 */
export class EmbeddingLoadError extends Error {
  readonly code:
    | 'MANIFEST_INVALID'
    | 'MODEL_LOAD_FAILED'
    | 'OUTPUT_DIM_MISMATCH'
    | 'OUTPUT_TENSOR_MISSING';
  override readonly cause: unknown;

  constructor(
    code: EmbeddingLoadError['code'],
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'EmbeddingLoadError';
    this.code = code;
    this.cause = cause;
  }
}

/**
 * Resource handle for the TFLite asset. `path` is what the native
 * binding's `loadTensorflowModel` expects — a `require()` result on
 * mobile, an absolute file URL otherwise. `manifest` is the parsed
 * JSON manifest committed alongside the `.tflite`.
 *
 * For v1 these are passed in by the screen layer (which calls
 * `require('./model.tflite')` directly). On-device updates from R2
 * are a follow-up.
 */
export interface LoadEmbeddingModelOptions {
  /** Whatever `loadTensorflowModel`'s first arg accepts. */
  readonly modelSource: unknown;
  /** Parsed JSON of the manifest committed next to the .tflite. */
  readonly manifest: unknown;
  /**
   * Override the global telemetry emitter (tests pass their own to
   * keep listener state hermetic).
   */
  readonly telemetry?: EmbedTelemetryEmitter;
  /**
   * Force a delegate. Defaults to `'auto'` — try GPU, fall back to
   * CPU. Tests pass `'cpu'` to skip the GPU try/catch.
   */
  readonly delegatePreference?: 'auto' | 'cpu';
}

const IOS_GPU_DELEGATE: TfliteDelegate = 'core-ml';
const ANDROID_GPU_DELEGATE: TfliteDelegate = 'android-gpu';
const CPU_DELEGATES: readonly TfliteDelegate[] = [];

/**
 * Load + validate the on-device embedding model.
 *
 * Throws an `EmbeddingLoadError` on any failure. Callers should
 * `try/catch` and degrade gracefully (scanner is unavailable on this
 * device; manual entry still works).
 */
export async function loadEmbeddingModel(
  options: LoadEmbeddingModelOptions,
): Promise<EmbeddingModelHandle> {
  const manifest = validateManifest(options.manifest);
  const { model, delegate } = await loadWithDelegateFallback(
    options.modelSource,
    options.delegatePreference ?? 'auto',
  );
  ensureOutputMatchesManifest(model, manifest);

  const emitter = options.telemetry ?? embedTelemetry;
  let disposed = false;

  return {
    embeddingDim: manifest.embeddingDim,
    delegate,
    isUsingGpu: delegate === 'gpu',
    modelName: manifest.name,
    modelVersion: manifest.version,

    async embed(frame: EmbedFrameInput): Promise<Float32Array> {
      if (disposed) {
        throw new Error('embedding model has been disposed');
      }
      const startedAt = performanceNow();
      const inputTensor = preprocessFromFrame(
        frame,
        manifest.inputShape,
        manifest.normalization,
      );

      // `Float32Array.buffer` is typed as `ArrayBufferLike` (which
      // includes `SharedArrayBuffer`); the binding only accepts
      // `ArrayBuffer`. Slice to get a fresh, owned ArrayBuffer of the
      // exact byte range — this is also what vision-camera's resize
      // plugin example does, and it sidesteps potential aliasing.
      const inputBuffer = inputTensor.buffer.slice(
        inputTensor.byteOffset,
        inputTensor.byteOffset + inputTensor.byteLength,
      ) as ArrayBuffer;
      const outputs = await model.run([inputBuffer]);
      const raw = outputs[0];
      if (!raw) {
        throw new EmbeddingLoadError(
          'OUTPUT_TENSOR_MISSING',
          'TFLite model returned no output tensor',
        );
      }
      const normalised = postprocessEmbedding(raw, manifest.embeddingDim);

      const duration = performanceNow() - startedAt;
      emitter.emit({
        durationMs: duration,
        delegate,
        framePixels: frame.width * frame.height,
      });

      return normalised;
    },

    dispose() {
      disposed = true;
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers — exported only via `loadEmbeddingModel`; kept here so the
// public surface in `index.ts` stays narrow.
// ---------------------------------------------------------------------------

function validateManifest(raw: unknown): EmbeddingManifest {
  try {
    return parseManifest(raw);
  } catch (cause) {
    if (cause instanceof ZodError) {
      throw new EmbeddingLoadError(
        'MANIFEST_INVALID',
        `manifest failed schema validation: ${cause.message}`,
        cause,
      );
    }
    if (cause instanceof SyntaxError) {
      throw new EmbeddingLoadError(
        'MANIFEST_INVALID',
        `manifest JSON did not parse: ${cause.message}`,
        cause,
      );
    }
    throw cause;
  }
}

async function loadWithDelegateFallback(
  modelSource: unknown,
  preference: 'auto' | 'cpu',
): Promise<{ model: LoadedTensorflowModel; delegate: InferenceDelegate }> {
  if (preference === 'cpu') {
    return loadCpu(modelSource);
  }

  // Try GPU on whichever platform we're on. The native binding
  // throws synchronously on some Android devices that report having
  // a GPU but lack the OpenGL extensions react-native-fast-tflite
  // needs — that's exactly the path the stage rules require us to
  // handle.
  for (const delegate of platformGpuCandidates()) {
    try {
      const model = await loadTensorflowModel(modelSource, [delegate]);
      return { model, delegate: 'gpu' };
    } catch {
      // Try the next candidate; if all GPU candidates fail, drop to CPU.
    }
  }

  return loadCpu(modelSource);
}

async function loadCpu(
  modelSource: unknown,
): Promise<{ model: LoadedTensorflowModel; delegate: InferenceDelegate }> {
  try {
    const model = await loadTensorflowModel(modelSource, CPU_DELEGATES);
    return { model, delegate: 'cpu' };
  } catch (cause) {
    throw new EmbeddingLoadError(
      'MODEL_LOAD_FAILED',
      'TFLite model failed to load on both GPU and CPU delegates',
      cause,
    );
  }
}

function platformGpuCandidates(): readonly TfliteDelegate[] {
  // We don't import Platform here (the test setup mocks `react-native`
  // but the rest of the embed module is platform-agnostic). Trying
  // both delegate names and letting the native binding reject the
  // wrong one is cheap and keeps this file free of an RN dep.
  return [IOS_GPU_DELEGATE, ANDROID_GPU_DELEGATE];
}

function ensureOutputMatchesManifest(
  model: LoadedTensorflowModel,
  manifest: EmbeddingManifest,
): void {
  const outputs = model.outputs ?? [];
  if (outputs.length === 0) {
    throw new EmbeddingLoadError(
      'OUTPUT_TENSOR_MISSING',
      'TFLite model has no output tensors',
    );
  }
  // `react-native-fast-tflite` reports the output shape as a number[].
  // We accept either [embeddingDim] or [1, embeddingDim] — TFLite
  // models sometimes squeeze the batch dim, sometimes don't.
  const first = outputs[0];
  if (!first) {
    throw new EmbeddingLoadError(
      'OUTPUT_TENSOR_MISSING',
      'TFLite model has no output tensors',
    );
  }
  const shape = first.shape;
  const actualDim = shape[shape.length - 1];
  if (actualDim !== manifest.embeddingDim) {
    throw new EmbeddingLoadError(
      'OUTPUT_DIM_MISMATCH',
      `manifest embeddingDim ${manifest.embeddingDim} disagrees with loaded model output ${actualDim}`,
    );
  }
}

// Bound to `performance.now()` when available, falling back to
// `Date.now()` — `performance.now()` is monotonic and microsecond-
// resolution which is what we want for latency telemetry, but RN's
// Hermes engine has historically had patchy `performance` support.
function performanceNow(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

// Re-exported so other modules can `import { EmbeddingManifestSchema } from '../loader'`.
export { EmbeddingManifestSchema };
