// Public types for the grading capture flow.
//
// The session shape carries the **full PROJECT.md § 12 shot set**:
// `front_url + back_url + corner_urls[0..3] + surface_url`. It maps
// to the `grading_submission` row from `context/data-model.md` and
// to the `gradingCaptureShotSetSchema` / `cornerUrls` contract in
// `@binderly/api-contracts` (the four corner kinds map to
// `cornerUrls` in canonical `[TL, TR, BL, BR]` order). The shot
// taxonomy here is the on-device capture model; the upload step
// converts the local URIs into the URL-bearing submission DTO.

/**
 * The seven shots in the full capture flow, in user-visible order.
 *
 * - `frontFull` — full portrait of the front, used for centering +
 *   surface.
 * - `backFull` — full portrait of the back, used for centering +
 *   the back-side corners model.
 * - `frontCorner` — close-up of the top-left corner (`cornerUrls[0]`).
 * - `backCorner` — close-up of the top-right corner (`cornerUrls[1]`).
 * - `bottomLeftCorner` — close-up of the bottom-left corner
 *   (`cornerUrls[2]`).
 * - `bottomRightCorner` — close-up of the bottom-right corner
 *   (`cornerUrls[3]`).
 * - `surface` — raking-light angled shot of the front; reveals
 *   whitening / scratches for the surface sub-grade.
 */
export type GradingShotKind =
  | 'frontFull'
  | 'backFull'
  | 'frontCorner'
  | 'backCorner'
  | 'bottomLeftCorner'
  | 'bottomRightCorner'
  | 'surface';

/** Overlay shape rendered on top of the camera surface. */
export type CaptureOverlayKind =
  | 'full-portrait'
  | 'corner-top-left'
  | 'corner-top-right'
  | 'corner-bottom-left'
  | 'corner-bottom-right'
  | 'surface-raking';

/** Per-step constants — declared in `constants.ts`, consumed everywhere. */
export interface CaptureStepDefinition {
  readonly kind: GradingShotKind;
  /** Zero-based index into the step order. */
  readonly index: number;
  /** Bold heading shown above the framing overlay. */
  readonly title: string;
  /** Sentence guiding the user through the framing. */
  readonly instruction: string;
  /** Overlay shape to render. */
  readonly overlay: CaptureOverlayKind;
  /** Minimum frame-fraction the detected card region must cover. */
  readonly coverageMin: number;
  /**
   * Per-step lower brightness bound override. The raking-light
   * surface shot is intentionally captured under angled light and
   * runs darker than a flat full-card shot, so it relaxes the
   * default floor. Omitted ⇒ the global `CAPTURE_BRIGHTNESS_MIN`.
   */
  readonly brightnessMin?: number;
  /** Per-step upper brightness bound override. Omitted ⇒ global max. */
  readonly brightnessMax?: number;
  /** Per-step sharpness floor override. Omitted ⇒ global min. */
  readonly sharpnessMin?: number;
}

/** Quality metrics for a single capture attempt. All values are real. */
export interface CaptureQualityMetrics {
  /** Mean absolute gradient over the analysis grid. */
  readonly sharpness: number;
  /** Mean luminance, normalised to `[0, 1]`. */
  readonly brightness: number;
  /** Fraction of the frame covered by the high-contrast region. */
  readonly coverage: number;
}

/**
 * Why the most recent capture attempt did or did not pass the
 * quality gate. Drives the feedback banner copy.
 *
 * - `'great'` — pass; all gates clean.
 * - `'too_dark'` — brightness below the gate.
 * - `'over_exposed'` — brightness above the gate.
 * - `'blurry'` — sharpness below the gate.
 * - `'off_center'` — coverage below the kind's minimum (full or
 *   corner). Surfaced as "fill the frame" guidance.
 * - `'no_card_detected'` — coverage is essentially zero — empty
 *   frame or featureless surface.
 */
export type CaptureFeedbackReason =
  | 'great'
  | 'too_dark'
  | 'over_exposed'
  | 'blurry'
  | 'off_center'
  | 'no_card_detected';

/** Aggregated quality decision for a single capture attempt. */
export interface CaptureQualityResult {
  readonly metrics: CaptureQualityMetrics;
  readonly sharpnessOK: boolean;
  readonly brightnessOK: boolean;
  readonly coverageOK: boolean;
  /** Overall pass — all three OKs must be true. */
  readonly accepted: boolean;
  /**
   * One **primary** feedback reason. Ranked: brightness first (the
   * user can fix lighting), then sharpness (steady the phone),
   * then coverage (re-frame). Always set, even on accept (=`'great'`).
   */
  readonly reason: CaptureFeedbackReason;
}

/**
 * A captured shot — file URI plus quality metrics. The file URI is
 * the local on-device path vision-camera's `takePhoto()` returns;
 * we never upload from here.
 */
export interface GradingShot {
  readonly kind: GradingShotKind;
  /** Local file URI returned by `takePhoto()`. */
  readonly uri: string;
  /** Source-pixel width of the captured image. */
  readonly width: number;
  /** Source-pixel height of the captured image. */
  readonly height: number;
  /** Quality metrics recorded at accept-time. */
  readonly quality: CaptureQualityResult;
  /** Capture timestamp (ms since epoch). */
  readonly capturedAt: number;
}

/**
 * The session emitted to the next screen when every shot is
 * accepted. Keys match the step kinds 1-to-1 so downstream grading
 * tasks can destructure deterministically. The four corner shots
 * map to the `cornerUrls` contract in canonical `[TL, TR, BL, BR]`
 * order; `surface` maps to the raking-light `surfaceUrl`.
 */
export interface GradingCaptureSession {
  readonly frontFull: GradingShot;
  readonly backFull: GradingShot;
  readonly frontCorner: GradingShot;
  readonly backCorner: GradingShot;
  readonly bottomLeftCorner: GradingShot;
  readonly bottomRightCorner: GradingShot;
  readonly surface: GradingShot;
  /** Session id (uuid-ish). Used by the review screen for testIDs. */
  readonly id: string;
  /** Session start timestamp (ms since epoch). */
  readonly startedAt: number;
  /** Session complete timestamp (ms since epoch). */
  readonly completedAt: number;
}

/** In-progress reducer state — public so the hook + tests can pin it. */
export interface CaptureSessionState {
  readonly id: string;
  readonly startedAt: number;
  /**
   * Index of the **current** step (0-based; equals the total step
   * count when the session is complete).
   */
  readonly stepIndex: number;
  /** Accepted shots so far, keyed by kind. */
  readonly shots: Partial<Record<GradingShotKind, GradingShot>>;
  /**
   * The most recent feedback reason, if any. `null` between
   * captures (initial state + after a successful advance with no
   * new attempt yet).
   */
  readonly lastReason: CaptureFeedbackReason | null;
  /** True iff every shot has been accepted. */
  readonly isComplete: boolean;
}
