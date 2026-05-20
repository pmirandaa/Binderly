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
 * The four shots, in capture order. The order is the **user-facing
 * step order** (1..4) and the keys are the emitted-session keys.
 * Adding a fifth shot (e.g. surface raking light, follow-up
 * `FU-T-GR-CAPTURE-FULL-SCHEMA`) is an append + matching test
 * update — no other code changes.
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
    title: 'Front corner close-up',
    instruction:
      'Zoom in on the top-left front corner. Fill the small square with just the corner.',
    overlay: 'corner-top-left',
    coverageMin: CAPTURE_CORNER_COVERAGE_MIN,
  },
  {
    kind: 'backCorner',
    index: 3,
    title: 'Back corner close-up',
    instruction:
      'Flip the card. Zoom in on the top-right back corner. Fill the small square with just the corner.',
    overlay: 'corner-top-right',
    coverageMin: CAPTURE_CORNER_COVERAGE_MIN,
  },
];

/** Total number of capture steps. Source of truth for the step indicator. */
export const CAPTURE_STEP_COUNT: number = CAPTURE_STEPS.length;

/** Order of shot kinds, suitable for index lookup. */
export const CAPTURE_KINDS: ReadonlyArray<GradingShotKind> = CAPTURE_STEPS.map(
  (step) => step.kind,
);

/**
 * Route the screen pushes after the fourth accepted shot. Today's
 * target is the placeholder review screen this task ships; the
 * real T-GR-CENTERING screen swaps in when that task lands.
 */
export const CAPTURE_REVIEW_ROUTE = '/grading/capture/review';
