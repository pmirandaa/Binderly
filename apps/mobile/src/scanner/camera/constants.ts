// Tunables for the scanner camera infrastructure.
//
// These are the source-of-truth knobs the rest of the scanner stage
// reads from. Downstream tasks (T-SC-DETECT, T-SC-UX) consume them
// rather than threading their own numbers through; a future
// settings UI flips a single constant here and the whole pipeline
// follows.
//
// Battery rule from `rules/06-scanner.md`: target ~10 FPS, not 60.
// The vision-camera Camera component is told this as an explicit
// `fps` prop (and the frame processor is gated to the same rate);
// "best effort" wording in vendor docs is intentionally avoided.

/**
 * Frame-processor target frame rate, in frames per second.
 *
 * Battery-friendly default per `rules/06-scanner.md`. The Camera
 * component receives this value via its `fps` prop; the frame
 * processor additionally throttles redundant invocations via the
 * `frame-throttle` utility so we never exceed it under load.
 */
export const TARGET_FRAME_RATE_FPS = 10;

/**
 * Minimum gap between two successful frame-processor invocations,
 * in milliseconds. Derived from {@link TARGET_FRAME_RATE_FPS}.
 *
 * The throttle is conservative — we accept the first frame in any
 * window so the placeholder telemetry emits promptly, then suppress
 * the rest of the window. This keeps the JS bridge load proportional
 * to the cap even if the underlying camera pipeline delivers faster.
 */
export const FRAME_PROCESSOR_MIN_INTERVAL_MS = Math.floor(
  1_000 / TARGET_FRAME_RATE_FPS,
);

/**
 * Number of recent frame events the FPS telemetry sink retains.
 * Sized to cover at least three seconds at the target rate so the
 * sliding-window FPS estimator is stable even when frames dribble in.
 */
export const FRAME_TELEMETRY_RING_SIZE = 32;

/**
 * Stack-mode ring buffer capacity, in frames. Sized to hold roughly
 * three seconds of frame-stability metrics at the target rate.
 * T-SC-DETECT will tune this once the geometry-stability algorithm
 * is real; the seam stays here.
 */
export const STACK_MODE_RING_SIZE = 32;

/**
 * Stack-mode reset signal threshold: a "card removed" / "different
 * card geometry" decision must observe at least this gap of
 * unstable frames before the detector emits `'reset'`. Per
 * `PROJECT.md` § 11.
 */
export const STACK_MODE_RESET_WINDOW_MS = 300;

/**
 * FPS-badge update cadence. The badge polls the telemetry sink on
 * this interval; a longer interval would feel laggy, a shorter one
 * would burn JS-thread cycles on a debug overlay.
 */
export const FPS_BADGE_UPDATE_INTERVAL_MS = 500;
