// Zod schema mirroring `apps/api-python/embeddings/manifest.py`.
//
// The on-device loader validates the manifest before constructing
// the model handle. The schema is intentionally narrow:
//
//   - `inputShape` is `[batch, height, width, channels]` and only
//     `channels === 3` is supported in v1.
//   - `normalization` is a fixed enum that mirrors the Python
//     `PREPROCESSING_NAMES` tuple. Adding a recipe requires changes
//     to both sides.
//   - `modelHash` must be a 64-char hex SHA-256 — same as the Python
//     side.
//
// If the on-device interpreter loads a model whose actual output
// length disagrees with `embeddingDim`, the loader fails loudly.

import { z } from 'zod';

const HEX_64 = /^[0-9a-fA-F]{64}$/;

const PreprocessingSchema = z.enum(['mobilenet_v3', 'zero_one', 'imagenet']);

export const EmbeddingManifestSchema = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1),
    modelHash: z.string().regex(HEX_64, 'modelHash must be 64-char hex SHA-256'),
    inputShape: z
      .array(z.number().int().positive())
      .length(4, 'inputShape must be [batch, height, width, channels]'),
    embeddingDim: z.number().int().positive(),
    normalization: PreprocessingSchema,
    createdAt: z.string().min(1),
    sourceUrl: z.string().nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.inputShape[3] !== 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['inputShape', 3],
        message: 'inputShape channel dim must be 3 (RGB) in v1',
      });
    }
  });

export type EmbeddingManifest = z.infer<typeof EmbeddingManifestSchema>;
export type PreprocessingName = z.infer<typeof PreprocessingSchema>;

/**
 * Parse a JSON string into a validated `EmbeddingManifest`.
 *
 * Throws a `ZodError` on schema failure. The bundled-asset loader
 * catches this and surfaces a typed `EmbeddingLoadError` instead.
 */
export function parseManifest(raw: unknown): EmbeddingManifest {
  if (typeof raw === 'string') {
    return EmbeddingManifestSchema.parse(JSON.parse(raw));
  }
  return EmbeddingManifestSchema.parse(raw);
}
