// Pure confidence classifier.
//
// Given a ranked candidate list (already cosine-descending from the
// ANN search), decide whether the result is good enough to:
//
//   - `auto-add`: top-1 ≥ autoAddScore AND top1-top2 ≥ topGapMin
//   - `disambiguate`: top-1 ≥ disambigScore (but failed auto-add)
//   - `reject`: top-1 below the disambig floor
//
// Everything here is a pure function so the matcher's hot-path
// state machine stays trivial to unit-test.

import type { MatchConfig, MatchDisposition } from './types.js';
import type { AnnSearchResult } from '@/scanner/ann';


/** Outcome of {@link classifyConfidence}. */
export interface ConfidenceVerdict {
  /** `'reject'` means the matcher should drop this detection silently. */
  readonly disposition: MatchDisposition | 'reject';
  /** Top-1 score that drove the verdict. `0` for an empty list. */
  readonly confidence: number;
  /** `top1.score - top2.score`. `+Infinity` when only one candidate. */
  readonly topGap: number;
  /**
   * Top-1 `printingId`. Empty string when the candidate list is
   * empty — callers should branch on `disposition` instead of
   * inspecting this directly.
   */
  readonly printingId: string;
}

/**
 * Classify a ranked candidate list against the live config.
 *
 * @param candidates  Top-K results from `searchKNN()`, descending
 *                    by score. Empty list → `'reject'`.
 * @param config      Live matcher config (auto-add / disambig
 *                    thresholds + min gap).
 */
export function classifyConfidence(
  candidates: readonly AnnSearchResult[],
  config: Pick<MatchConfig, 'autoAddScore' | 'disambigScore' | 'topGapMin'>,
): ConfidenceVerdict {
  const top = candidates[0];
  if (!top) {
    return {
      disposition: 'reject',
      confidence: 0,
      topGap: Number.POSITIVE_INFINITY,
      printingId: '',
    };
  }
  const second = candidates[1];
  const topGap = second ? top.score - second.score : Number.POSITIVE_INFINITY;

  if (top.score >= config.autoAddScore && topGap >= config.topGapMin) {
    return {
      disposition: 'auto-add',
      confidence: top.score,
      topGap,
      printingId: top.printingId,
    };
  }
  if (top.score >= config.disambigScore) {
    return {
      disposition: 'disambiguate',
      confidence: top.score,
      topGap,
      printingId: top.printingId,
    };
  }
  return {
    disposition: 'reject',
    confidence: top.score,
    topGap,
    printingId: top.printingId,
  };
}
