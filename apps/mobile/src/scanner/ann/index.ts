// Public surface of the on-device ANN module.
//
// The scanner screen wires `loadAnnIndex` once on mount (alongside
// `loadEmbeddingModel`), holds the returned handle, and calls
// `handle.searchKNN(queryVec, k)` from `T-SC-MATCH` to turn a query
// embedding into a ranked list of catalog printings.

export { AnnLoadError, loadAnnIndex } from './loader';
export {
  AnnFormatError,
  DTYPE_FLOAT16,
  DTYPE_FLOAT32,
  HEADER_SIZE_BYTES,
  INDEX_FORMAT_VERSION,
  INDEX_MAGIC,
  parseHeader,
  parseIndex,
} from './format';
export {
  AnnManifestSchema,
  parseAnnManifest,
  type AnnDtypeName,
  type AnnFormatName,
  type AnnManifest,
  type AnnMetricName,
} from './manifest';
export { AnnSearchError, searchKnnFlat } from './search';
export type {
  AnnDtype,
  AnnFormat,
  AnnIndexHandle,
  AnnLoadOptions,
  AnnMetric,
  AnnSearchResult,
} from './types';
