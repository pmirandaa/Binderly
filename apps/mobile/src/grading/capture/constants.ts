// Tunables for the grading capture flow.
//
// The capture flow is event-driven (one `takePhoto()` per user
// tap), not continuous like the scanner's 10-FPS detection loop —
// so the quality budget here is **stricter** than scanner-side.
// The user can re-take any shot before it counts; the downstream
// centering + subgrade modules need high-quality input.
//
// Numeric values are the v1 dispatch's best guesses, tuned against
// the synthetic test fixtures in `__tests__/`. Reality (real
// camera output) re-tunes these once T-GR-CENTERING smokes against
// device captures.

import type { CaptureStepDefinition, GradingShotKind } from './types.js';

/**
 * Minimum mean-absolute-gradient inside the **whole frame** for a
 * capture to count as "sharp enough". Higher than the scanner's
 * `QUALITY_SHARPNESS_MIN = 6.0` because the user can re-take.
 */
export const CAPTURE_SHARPNESS_MIN = 9.0;

/**
 * Lower bound on the frame's mean luminance (0..1 normalised).
 * Tighter than scanner's `0.10` floor — a too-dark capture kills
 * the centering measurement on the front/back shots.
 */
export const CAPTURE_BRIGHTNESS_MIN = 0.18;

/**
 * Upper bound on the frame's mean luminance (0..1 normalised).
 * Tighter than scanner's `0.92` ceiling — over-exposed glare
 * across the card body hides corner damage and surface scratches.
 */
export const CAPTURE_BRIGHTNESS_MAX = 0.85;

/**
 * Fraction of the analysis-grid's interior pixels whose gradient
 * magnitude exceeds {@link CAPTURE_COVERAGE_ACTIVITY_RATIO} times
 * the max gradient — our cheap "is the card filling the frame"
 * proxy. Edge pixels + interior detail (text, art, holographic
 * shimmer) all contribute. A 70-80% screen-width card with normal
 * card art lands around 0.10-0.15; a thumbnail-sized card lands
 * around 0.03-0.05; an empty frame is 0.
 *
 * Tuned against the synthetic fixtures — not against real camera
 * imagery, see Notes from execution.
 */
export const CAPTURE_FULL_COVERAGE_MIN = 0.08;

/**
 * Same metric as {@link CAPTURE_FULL_COVERAGE_MIN} but the corner-
 * detail shot is intentionally a closer crop, so the activity
 * fraction stays lower (corner content is uniform foil / cardboard
 * with two-edge framing rather than a full art panel). Below this
 * value the user is framing the whole card instead of zooming on
 * the corner.
 */
export const CAPTURE_CORNER_COVERAGE_MIN = 0.04;

/**
 * Lower brightness bound for the **raking-light surface shot**. The
 * surface step is captured under deliberately angled, low light to
 * throw whitening / scratches into relief, so its frame mean sits
 * well below a flat full-card shot. We relax the floor (vs the
 * {@link CAPTURE_BRIGHTNESS_MIN} = 0.18 default) so a correctly-lit
 * raking shot isn't rejected as `too_dark`, while still catching a
 * lens-cap-on / pitch-black frame. The upper bound is unchanged —
 * raking light should never be bright enough to wash out detail.
 */
export const CAPTURE_SURFACE_BRIGHTNESS_MIN = 0.08;

/**
 * Analysis-grid the quality evaluator downsamples to before
 * computing gradients. Same posture as scanner-side
 * (`DETECT_GRID_WIDTH × DETECT_GRID_HEIGHT = 96 × 128`) but kept
 * local to avoid coupling to the scanner constants.
 */
export const CAPTURE_GRID_WIDTH = 96;
export const CAPTURE_GRID_HEIGHT = 128;

/**
 * Threshold (as a fraction of `max(gradient)`) used by the
 * coverage estimator: a pixel counts as "card body" if its
 * gradient magnitude exceeds the threshold. Lower = more eager
 * (catches faint card edges); higher = stricter.
 */
export const CAPTURE_COVERAGE_ACTIVITY_RATIO = 0.25;

/**
 * The full PROJECT.md § 12 shot set, in capture order. The order is
 * the **user-facing step order** and the keys are the emitted-session
 * keys: full front, full back, the four corner close-ups
 * (top-left → top-right → bottom-left → bottom-right, mapping to
 * `cornerUrls[0..3]`), then the raking-light surface shot.
 *
 * The reducer + UI are length-agnostic — they derive everything from
 * this array — so adding or reordering shots is an edit here plus a
 * matching test update, no other code changes.
 */
export const CAPTURE_STEPS: ReadonlyArray<CaptureStepDefinition> = [
  {
    kind: 'frontFull',
    index: 0,
    title: 'Front of card',
    instruction:
      'Fill the rectangle with the front of the card. Hold the phone steady, parallel to the card.',
    overlay: 'full-portrait',
    coverageMin: CAPTURE_FULL_COVERAGE_MIN,
  },
  {
    kind: 'backFull',
    index: 1,
    title: 'Back of card',
    instruction:
      'Flip the card over. Fill the rectangle with the back, same framing as the front.',
    overlay: 'full-portrait',
    coverageMin: CAPTURE_FULL_COVERAGE_MIN,
  },
  {
    kind: 'frontCorner',
    index: 2,
    title: 'Top-left corner',
    instruction:
      'Zoom in on the top-left corner. Fill the small square with just the corner.',
    overlay: 'corner-top-left',
    coverageMin: CAPTURE_CORNER_COVERAGE_MIN,
  },
  {
    kind: 'backCorner',
    index: 3,
    title: 'Top-right corner',
    instruction:
      'Zoom in on the top-right corner. Fill the small square with just the corner.',
    overlay: 'corner-top-right',
    coverageMin: CAPTURE_CORNER_COVERAGE_MIN,
  },
  {
    kind: 'bottomLeftCorner',
    index: 4,
    title: 'Bottom-left corner',
    instruction:
      'Zoom in on the bottom-left corner. Fill the small square with just the corner.',
    overlay: 'corner-bottom-left',
    coverageMin: CAPTURE_CORNER_COVERAGE_MIN,
  },
  {
    kind: 'bottomRightCorner',
    index: 5,
    title: 'Bottom-right corner',
    instruction:
      'Zoom in on the bottom-right corner. Fill the small square with just the corner.',
    overlay: 'corner-bottom-right',
    coverageMin: CAPTURE_CORNER_COVERAGE_MIN,
  },
  {
    kind: 'surface',
    index: 6,
    title: 'Surface (raking light)',
    instruction:
      'Tilt the phone so light rakes across the front at a low angle, then fill the rectangle. This reveals whitening and scratches.',
    overlay: 'surface-raking',
    coverageMin: CAPTURE_FULL_COVERAGE_MIN,
    brightnessMin: CAPTURE_SURFACE_BRIGHTNESS_MIN,
  },
];

/** Total number of capture steps. Source of truth for the step indicator. */
export const CAPTURE_STEP_COUNT: number = CAPTURE_STEPS.length;

/** Order of shot kinds, suitable for index lookup. */
export const CAPTURE_KINDS: ReadonlyArray<GradingShotKind> = CAPTURE_STEPS.map(
  (step) => step.kind,
);

/**
 * Per-kind coverage floor, derived from {@link CAPTURE_STEPS}. The
 * live frame-processor + the screen look up the active step's gate
 * here without re-deriving it. Source of truth stays the step list.
 */
export const CAPTURE_COVERAGE_MIN_BY_KIND: Readonly<Record<GradingShotKind, number>> =
  Object.freeze(
    CAPTURE_STEPS.reduce(
      (acc, step) => {
        acc[step.kind] = step.coverageMin;
        return acc;
      },
      {} as Record<GradingShotKind, number>,
    ),
  );

/**
 * Route the screen pushes after the fourth accepted shot. Today's
 * target is the placeholder review screen this task ships; the
 * real T-GR-CENTERING screen swaps in when that task lands.
 */
export const CAPTURE_REVIEW_ROUTE = '/grading/capture/review';
