// Adapter: a completed capture session → the image references a community
// submission carries.
//
// The capture flow stores the full PROJECT.md § 12 shot set (front/back
// full + four corner crops + a raking-light surface shot) as **local file
// URIs** (`apps/mobile/src/grading/capture/types.ts`). The submission only
// needs references — the actual upload / R2 transcode is the separate #FU-39
// pipeline — so we pass those URIs straight through. The front/back fulls
// map to `front`/`back`; the four corner crops become the `corners` array in
// canonical `[TL, TR, BL, BR]` order; the raking-light shot maps to
// `surface`.

import type { CommunitySubmissionImages } from './types.js';
import type { GradingCaptureSession } from '../capture/types.js';

/** Map a completed capture session to community-submission image references. */
export function sessionToImages(session: GradingCaptureSession): CommunitySubmissionImages {
  return {
    front: session.frontFull.uri,
    back: session.backFull.uri,
    corners: [
      session.frontCorner.uri,
      session.backCorner.uri,
      session.bottomLeftCorner.uri,
      session.bottomRightCorner.uri,
    ],
    surface: session.surface.uri,
  };
}
