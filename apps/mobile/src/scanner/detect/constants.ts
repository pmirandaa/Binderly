// Tunables for the card-detection layer.
//
// Every numeric knob the worklet hot path reads from is declared
// here. T-SC-MATCH and the (future) scanner settings UI consume
// the same values so the whole pipeline stays consistent — flip
// one constant and every layer follows.
//
// Default values are the v1 dispatch's best guesses for a
// mid-tier Android (Pixel 6-class) holding a Pokémon card against
// a contrasting background. They are tuned against the synthetic
// test fixtures, not against real camera data — once T-SC-MATCH
// wires the full pipeline and Pablo's smoke surfaces real
// imagery, these are the knobs we tweak.

/**
 * Analysis-grid width the detection pipeline downsamples to before
 * computing gradients. Smaller = faster but loses edge resolution;
 * larger = slower but catches finer edges. 96 × 128 keeps each
 * frame under ~5 ms of pure-JS work on a Pixel 6-class device
 * while preserving enough edge detail for a card-sized rectangle.
 */
export const DETECT_GRID_WIDTH = 96;
/** Analysis-grid height. Mirrors {@link DETECT_GRID_WIDTH}. */
export const DETECT_GRID_HEIGHT = 128;

/**
 * Pokémon card aspect ratio — 3.5" / 2.5" = 1.4. The detected
 * rect's `max(h, w) / min(h, w)` should land near this target.
 */
export const CARD_ASPECT_TARGET = 1.4;

/**
 * Lower bound on the detected rect's aspect ratio. Below this we
 * treat the rect as "not card-shaped" — typically too square
 * (artefact of two-edge-only detection) or a sliver.
 */
export const CARD_ASPECT_MIN = 1.25;

/**
 * Upper bound on the detected rect's aspect ratio. Above this we
 * treat the rect as too elongated for a card — usually the
 * detection latched onto a single column of background detail.
 */
export const CARD_ASPECT_MAX = 1.6;

/**
 * Minimum mean-absolute-gradient inside the rect for the frame to
 * count as "sharp enough". Tuned on the synthetic test fixtures;
 * a sharp card edge produces gradients ≫ this floor while a
 * uniformly-blurred frame stays well below.
 *
 * Units: same scale as the underlying 0-255 luminance, i.e.
 * a value of `6.0` means "the average absolute gradient is at
 * least 6 luminance units between neighbouring pixels in the rect".
 */
export const QUALITY_SHARPNESS_MIN = 6.0;

/**
 * Lower bound on mean luminance inside the rect, 0-1 normalized
 * (i.e. `byte / 255`). Below this the frame is too dark to
 * embed reliably.
 */
export const QUALITY_BRIGHTNESS_MIN = 0.1;

/**
 * Upper bound on mean luminance inside the rect, 0-1 normalized.
 * Above this the frame is over-exposed — clipped detail kills the
 * embedding match.
 */
export const QUALITY_BRIGHTNESS_MAX = 0.92;

/**
 * Threshold ratio applied to the row/column gradient activity
 * profiles when scanning inward for the rect's edges. A column or
 * row counts as "card edge" when its activity exceeds
 * `RECT_ACTIVITY_THRESHOLD_RATIO * max(profile)`. Lower = more
 * eager detection (catches faint edges; risks latching onto
 * noise); higher = stricter (misses faint edges).
 */
export const RECT_ACTIVITY_THRESHOLD_RATIO = 0.35;

/**
 * Absolute noise floor for the activity profiles. If `max(profile)`
 * falls below this we report a degenerate detection — the frame
 * has no usable edges, typically because the camera is pointed at
 * a uniform surface.
 */
export const RECT_ACTIVITY_FLOOR = 12;

/**
 * Edge length of the normalised tensor we emit for T-SC-EMBED-MODEL.
 * 224 matches MobileNetV3-Small's input spec (`inputShape =
 * [1, 224, 224, 3]`); the value MUST stay in lockstep with the
 * embed module's manifest schema.
 */
export const CROP_TENSOR_SIZE = 224;
