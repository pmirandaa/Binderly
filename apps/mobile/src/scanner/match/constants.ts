// Tunables for the scanner read-path closer.
//
// Every numeric knob the matcher reads from is declared here so
// T-SC-UX (the downstream picker UI) and a future scanner-settings
// surface can pull from the same source. Flip a constant and every
// layer follows.
//
// The defaults are first-principles best guesses for L2-normalised
// cosine in [-1, 1]. Real calibration against labeled real-phone
// scans is a follow-up (#FU-30) — the auto-add FP < 0.5% target
// in `rules/06-scanner.md` is not a guarantee these defaults hit;
// it's the goal calibration will lock in.

/**
 * Top-1 cosine score at which we *auto-add* a match (skip the
 * disambiguation picker). Tuned for L2-normalised MobileNetV3-Small
 * embeddings: same-card-good-capture lands in 0.80-0.95 in our
 * dev-set probes; unrelated cards stay well below 0.30. 0.78 lets
 * the well-lit cases through reliably while keeping accidental
 * holos-of-different-art out.
 *
 * Pair with {@link MATCH_TOP_GAP_MIN} — both must be satisfied.
 */
export const MATCH_AUTO_ADD_SCORE = 0.78;

/**
 * Top-1 cosine score at which we surface a disambiguation picker
 * (UI shows top-3 candidates; user taps the right one). Below
 * this we drop the match silently.
 *
 * Sits comfortably below {@link MATCH_AUTO_ADD_SCORE} so a
 * blurry-but-still-recognisable scan routes into the picker
 * instead of the silent-drop path — most users would rather pick
 * from three than start over.
 */
export const MATCH_DISAMBIG_SCORE = 0.55;

/**
 * Minimum required gap between top-1 and top-2 cosine for an
 * auto-add to proceed. Catches the "two visually similar holos in
 * the same set" failure mode where top-1 and top-2 both score
 * high but the model can't tell them apart — promote those into
 * the disambiguation picker.
 */
export const MATCH_TOP_GAP_MIN = 0.04;

/**
 * Number of consecutive accepted detection frames with the same
 * top-1 `printingId` required before the matcher fires.
 *
 * The detect-stage frame processor is throttled to 10 FPS upstream
 * (`DETECT_FRAME_MIN_INTERVAL_MS = 100`); 3 frames = ~300 ms.
 * Robust to 1-2 transient blurs; imperceptible to the user.
 */
export const MATCH_STABILITY_COUNT = 3;

/**
 * Gap in milliseconds between accepted detection events at which
 * we reset the stability counter (Rules § 11: "card removed from
 * frame for >300 ms"). Also releases the post-fire cooldown so
 * the same printing can fire on the *next* card flip if the user
 * pulls the card out and back in.
 *
 * Set slightly above the 10-FPS sampling interval (100 ms) so a
 * single dropped frame doesn't break the chain.
 */
export const MATCH_STACK_RESET_MS = 350;

/**
 * Top-K candidates we ask the ANN index for. We need:
 *   - top-1 for the auto-add path
 *   - top-2 for the gap check
 *   - top-3 for the disambiguation picker
 *
 * 5 leaves slack so future tweaks (e.g. surfacing a "see more
 * candidates" affordance) don't need a constant bump.
 */
export const MATCH_K = 5;

/**
 * Maximum number of fired `MatchResult`s the in-session queue
 * holds before applying back-pressure. Overflow drops the oldest
 * entry — the UI is expected to flush on the user tapping "Done"
 * (or periodically as the toast queue drains).
 *
 * 32 is comfortably above what any single human can usefully
 * stack-scan in one session without re-aiming; the cap exists
 * as a memory-safety guard for the misbehaving case (e.g. UI
 * forgets to flush during a long dispatch).
 */
export const MATCH_QUEUE_CAP = 32;
