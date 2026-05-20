// Thin indirection over `react-native-fast-tflite`.
//
// The loader imports `loadTensorflowModel` from here so the vitest
// suite can mock this file (`vi.mock('@/scanner/embed/native', …)`)
// without dragging the native module's type graph into Node.
//
// react-native-fast-tflite v3 takes an *array* of delegate names —
// the binding tries them in order and falls back to CPU if none
// initialise. We still own the GPU→CPU fallback at the loader level
// because v3's binding can also throw synchronously on Android when
// the requested delegate's native libs aren't included via the Expo
// config plugin — the loader catches that throw and retries with a
// CPU-only call.
//
// Keep this file deliberately tiny — every export here corresponds to
// a real binding symbol so the mock stays trivially in sync.

import {
  loadTensorflowModel as nativeLoadTensorflowModel,
  type TensorflowModel as NativeTensorflowModel,
} from 'react-native-fast-tflite';

/**
 * Possible TFLite delegate names accepted by react-native-fast-tflite
 * v3. We expose them here so the loader's GPU/CPU fallback can pick
 * platform-appropriate candidates.
 */
export type TfliteDelegate = 'core-ml' | 'android-gpu' | 'nnapi';

/**
 * The shape we depend on from `react-native-fast-tflite`'s loaded
 * model. We re-declare it (rather than re-exporting the binding's
 * type) so the test mocks can satisfy it structurally without the
 * peer dep being installed in the test runner.
 */
export interface LoadedTensorflowModel {
  run(inputs: ArrayBuffer[]): Promise<ArrayBuffer[]>;
  inputs?: ReadonlyArray<{ name: string; shape: number[]; dataType: string }>;
  outputs?: ReadonlyArray<{ name: string; shape: number[]; dataType: string }>;
}

/**
 * Async loader. The native function returns a `TensorflowModel` that
 * structurally matches our `LoadedTensorflowModel`.
 *
 * `delegates` is an array per the v3 API; pass `[]` to use CPU only.
 */
export async function loadTensorflowModel(
  modelSource: unknown,
  delegates: readonly TfliteDelegate[],
): Promise<LoadedTensorflowModel> {
  const model = await (
    nativeLoadTensorflowModel as unknown as (
      src: unknown,
      d: readonly TfliteDelegate[],
    ) => Promise<NativeTensorflowModel>
  )(modelSource, delegates);
  return model as unknown as LoadedTensorflowModel;
}
