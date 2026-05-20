// `apps/mobile/src/scanner/match` — public barrel.
//
// T-SC-UX and any future scanner debug overlay import only from
// this barrel. The surface is deliberately narrow:
//
//   - `useScanner()` — React hook that ties the matcher to the
//     scanner screen's detection bus.
//   - `createMatcher()` — pure-JS constructor for tests, debug
//     tools, and the (future) headless smoke harness.
//   - `createMatchSink()` / `createMatchQueue()` — the two
//     in-process busses. Callers can instantiate their own to
//     pre-wire subscribers before mount.
//   - `classifyConfidence()` — pure verdict helper exposed for
//     the (future) debug overlay HUD.
//   - Constants — exposed so the scanner-settings UI (TBD) can
//     mirror the matcher tunables.

export {
  MATCH_AUTO_ADD_SCORE,
  MATCH_DISAMBIG_SCORE,
  MATCH_K,
  MATCH_QUEUE_CAP,
  MATCH_STABILITY_COUNT,
  MATCH_STACK_RESET_MS,
  MATCH_TOP_GAP_MIN,
} from './constants.js';

export { classifyConfidence, type ConfidenceVerdict } from './confidence.js';

export { createMatchQueue } from './match-queue.js';
export { createMatchSink } from './match-sink.js';
export { createMatcher, MATCH_DEFAULTS } from './matcher.js';
export { useScanner } from './use-scanner.js';

export type {
  EmbedCrop,
  MatchConfig,
  MatchDisposition,
  MatchListener,
  MatchQueue,
  MatchResult,
  MatchSink,
  MatcherDeps,
  MatcherHandle,
  SearchFn,
  UseScannerOptions,
  UseScannerResult,
} from './types.js';

// Pure stability helpers exposed for tests + the debug overlay.
// Not part of the production contract — production consumers use
// `createMatcher()`.
export {
  advanceStability,
  clearStability,
  createStabilityState,
  engageCooldown,
  type StabilityAdvance,
  type StabilityState,
} from './stability.js';
