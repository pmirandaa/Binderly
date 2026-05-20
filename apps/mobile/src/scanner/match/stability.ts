// Stability gate + stack-mode cooldown — pure state machine.
//
// Two responsibilities:
//
//   1. **Stability gate.** Require N consecutive accepted frames
//      with the same top-1 `printingId` before firing. Detection
//      runs at ~10 FPS upstream; the gate makes the matcher
//      robust to 1-2 transient blurs that would otherwise toggle
//      the recognised printing frame-to-frame.
//
//   2. **Stack-mode cooldown.** After firing for `printingId X`,
//      suppress further fires for X until either:
//        - `stackResetMs` ms elapse with no accepted detection
//          (Rules § 11: "card removed from frame for >300 ms"),
//          OR
//        - A *different* `printingId` stabilises through the gate
//          and fires (user flipped to the next card).
//
// Both pieces are pure — the matcher owns the state object and
// drives the transitions via the exported helpers.

/**
 * Mutable state the matcher carries. Live across the scanner-screen
 * lifetime; reset (`resetStability`) on screen mount.
 */
export interface StabilityState {
  /** `printingId` we've been counting up on. Empty == no run yet. */
  currentPrintingId: string;
  /** Consecutive frames at `currentPrintingId` (capped at the configured stability count). */
  count: number;
  /** Timestamp of the *most recent accepted* detection. `-Infinity` until the first. */
  lastAcceptedAtMs: number;
  /** `printingId` we most recently fired for (post-fire cooldown holds this). Empty == no fire yet. */
  cooldownPrintingId: string;
}

export function createStabilityState(): StabilityState {
  return {
    currentPrintingId: '',
    count: 0,
    lastAcceptedAtMs: Number.NEGATIVE_INFINITY,
    cooldownPrintingId: '',
  };
}

/** Reset the in-flight counter without releasing the cooldown. */
export function clearStability(state: StabilityState): void {
  state.currentPrintingId = '';
  state.count = 0;
}

/**
 * Outcome of a single {@link advanceStability} call.
 *
 * - `shouldFire === true` ⇒ the matcher should emit a `MatchResult`
 *   for `currentPrintingId`.
 * - `count` is the post-update consecutive frame count for
 *   `currentPrintingId` (clamped to the stability target).
 */
export interface StabilityAdvance {
  readonly shouldFire: boolean;
  readonly count: number;
}

/**
 * Advance the stability state with one accepted-detection
 * observation.
 *
 * @param state            Mutable state carried by the matcher.
 * @param printingId       Top-1 printingId from the candidate list.
 * @param nowMs            Monotonic timestamp of this detection.
 * @param stabilityCount   N consecutive frames required to fire.
 * @param stackResetMs     Gap (ms) at which we reset the counter.
 */
export function advanceStability(
  state: StabilityState,
  printingId: string,
  nowMs: number,
  stabilityCount: number,
  stackResetMs: number,
): StabilityAdvance {
  // Card-removed branch: if the gap since the last accepted
  // detection exceeds the reset window, this observation starts a
  // fresh stability run AND releases any post-fire cooldown.
  const gap = nowMs - state.lastAcceptedAtMs;
  const gapResets = gap > stackResetMs;
  if (gapResets) {
    state.cooldownPrintingId = '';
    state.currentPrintingId = printingId;
    state.count = 1;
  } else if (state.currentPrintingId === printingId) {
    // Same printing as the previous accepted frame → keep
    // counting up (capped at the target so the count doesn't grow
    // unboundedly across long static holds).
    if (state.count < stabilityCount) state.count += 1;
  } else {
    // Jitter (different printing): reset to 1 on the new id.
    state.currentPrintingId = printingId;
    state.count = 1;
  }
  state.lastAcceptedAtMs = nowMs;

  // Fire eligibility: hit the count target AND we're not still in
  // cooldown for this specific printing.
  const inCooldown = state.cooldownPrintingId === printingId;
  const shouldFire = state.count >= stabilityCount && !inCooldown;
  return { shouldFire, count: state.count };
}

/**
 * Record that the matcher fired for `printingId` — engage
 * post-fire cooldown for that printing. The cooldown releases
 * when {@link advanceStability} observes a `gap > stackResetMs`
 * (card removed) OR when a *different* printingId stabilises and
 * fires (which re-enters here with that other id).
 */
export function engageCooldown(state: StabilityState, printingId: string): void {
  state.cooldownPrintingId = printingId;
  // Re-arm the counter so the same fire doesn't dispatch twice.
  // The current printingId stays so we recognise the case of "user
  // is still holding the same card" and gate it correctly.
  state.count = 0;
}
