// Public barrel for the image pipeline. Downstream consumers
// (T-DL-SEED-INGEST, T-SC-EMBED-MODEL) import from
// `@binderly/data-pipeline` which re-exports this surface via
// `data-pipeline/src/index.ts`.

export {
  EXCLUDED_IMAGE_SOURCES,
  IMAGE_LICENSES,
  IMAGE_SOURCES,
  SOURCE_LICENSE_MAP,
  VARIANT_LADDER,
  VARIANT_NAMES,
  ImagePipelineError,
  FetchError,
  TranscodeError,
  StorageError,
  DedupError,
  InvariantError,
  isImagePipelineError,
} from './types.js';
export type {
  ImageLicense,
  ImagePipelineErrorContext,
  ImagePipelineErrorKind,
  ImageSource,
  ProcessImageInput,
  ProcessImagePrintingRef,
  ProcessedImageResult,
  ProcessedImageStatus,
  ProcessedImageVariant,
  VariantName,
  VariantSpec,
} from './types.js';

export { imageKeyFor, S3ImageStorage, createLocalMinioClient } from './storage.js';
export type { HeadResult, ImageStorage, PutOptions, S3ImageStorageConfig } from './storage.js';

export { transcode, isWebpBuffer } from './transcoder.js';
export type { TranscodeOptions, TranscodedVariant } from './transcoder.js';

export { InMemoryDedupResolver, sha256Hex, variantsFromList } from './dedup.js';
export type {
  DedupLookup,
  DedupUpsertInput,
  ImageDedupResolver,
  PrintingImageRow,
  PrintingImageVariantRecord,
  PrintingImageVariants,
} from './dedup.js';

export { processImage } from './processor.js';
