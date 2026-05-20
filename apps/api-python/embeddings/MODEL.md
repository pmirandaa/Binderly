# Embedding model — v1

## Choice

**MobileNetV3-Small** via `tf.keras.applications.MobileNetV3Small`
with ImageNet weights, classifier head stripped, average-pooled
features.

| Property               | Value                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------- |
| Name                   | `mobilenet-v3-small`                                                                    |
| Version                | `1.0.0`                                                                                 |
| Weights source         | `tf.keras.applications.MobileNetV3Small(weights="imagenet")` (bundled with TensorFlow)  |
| Upstream paper         | <https://arxiv.org/abs/1905.02244> (Howard et al., 2019)                                |
| Upstream weights URL   | <https://storage.googleapis.com/tensorflow/keras-applications/mobilenet_v3/>            |
| Input shape            | `(224, 224, 3)` RGB                                                                     |
| Preprocessing          | `tf.keras.applications.mobilenet_v3.preprocess_input` — scales to `[-1, 1]`             |
| Pooling                | `pooling="avg"` (global average pool of the final feature map)                          |
| Embedding dim          | `576`                                                                                   |
| Output normalisation   | L2-normalised at the host (Python) and on-device (TS) — never trust the model directly  |
| TFLite quantisation    | Dynamic-range int8 (smallest size, embedding-similarity-preserving)                     |
| Expected TFLite size   | ~5–6 MB                                                                                 |
| Target inference time  | < 100 ms on a Pixel-6-class device (published numbers: ~12 ms CPU, ~5 ms GPU delegate)  |

## Why MobileNetV3-Small

The brief listed four candidates. We pick MobileNetV3-Small for v1
because it sits on the Pareto frontier for this task:

| Candidate                    | Size       | Mid-range latency | Accuracy ceiling on natural images | TFLite + GPU-delegate maturity | Verdict      |
| ---------------------------- | ---------- | ----------------- | ---------------------------------- | ------------------------------ | ------------ |
| **MobileNetV3-Small**        | ~5–6 MB    | ~12 ms / ~5 ms    | Adequate for ≥ 95 % top-1 if ANN is tuned | Excellent (native TFLite ops)  | **chosen**   |
| EfficientNet-B0              | ~22 MB     | ~30 ms+           | Slightly better                    | Good                            | over-budget for v1 |
| OpenAI CLIP ViT-B/32 encoder | ~88 MB (q) | 100 ms+           | Best by a wide margin              | Patchy (ViT ops, attention)     | over-budget, defer  |
| Custom contrastive model     | TBD        | TBD               | Potentially best                   | Same as the base it's built on  | needs labelled data we don't have |

If real-world data shows top-1 < 90 % on phone scans, the natural
next step is to *fine-tune* MobileNetV3-Small via triplet / contrastive
loss on labelled card-scan triples, NOT to swap to a heavier base
model. Embedding dim and TFLite footprint stay constant; only the
weights change.

## Reproducing the build

```bash
cd apps/api-python
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e '.[build,dev]'
binderly-build-tflite \
  --output-dir ../../infra/models/mobilenet-v3-small/1.0.0 \
  --model-name mobilenet-v3-small \
  --model-version 1.0.0
```

The script:

1. Instantiates `MobileNetV3Small(include_top=False, pooling='avg',
   weights='imagenet')` against the standard `(224, 224, 3)` input.
2. Wraps it in a `tf.lite.TFLiteConverter` with
   `optimizations=[tf.lite.Optimize.DEFAULT]` (dynamic-range int8).
3. Asserts the TFLite file is < 25 MB and runs a single-image
   sanity inference.
4. Emits `manifest.json` next to the `.tflite` file:

```json
{
  "name": "mobilenet-v3-small",
  "version": "1.0.0",
  "modelHash": "<sha256 of .tflite>",
  "inputShape": [1, 224, 224, 3],
  "embeddingDim": 576,
  "normalization": "mobilenet_v3",
  "createdAt": "<ISO 8601>",
  "sourceUrl": "https://storage.googleapis.com/tensorflow/keras-applications/mobilenet_v3/"
}
```

The shipped artefact path on R2 (set by `rules/06-scanner.md`):
`models/mobilenet-v3-small/1.0.0/{model.tflite,manifest.json}`.

For v1 the file is bundled with the mobile app build (< 25 MB so no
LFS, no on-device fetch); on-device updates from R2 are a follow-up.

## Open follow-ups

- Fine-tune on labelled card-scan triples once we have a calibration
  set (owned by future `T-SC-MODEL-FINETUNE`).
- Per-language variants (JP) — single English variant for v1.
- On-device model updates from R2 — bundle-only for v1; flag for a
  future `T-SC-MODEL-OTA` task.
