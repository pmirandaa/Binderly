// Adapter: a completed capture session → the image references a community
// submission carries.
//
// The capture flow stores four shots (front/back full + two corner crops) as
// **local file URIs** (`apps/mobile/src/grading/capture/types.ts`). The
// submission only needs references — the actual upload / R2 transcode is the
// separate #FU-39 pipeline — so we pass those URIs straight through. The
// front/back fulls map to `front`/`back`; the two corner crops become the
// `corners` array.

import type { CommunitySubmissionImages } from './types.js';
import type { GradingCaptureSession } from '../capture/types.js';

/** Map a completed capture session to community-submission image references. */
export function sessionToImages(session: GradingCaptureSession): CommunitySubmissionImages {
  return {
    front: session.frontFull.uri,
    back: session.backFull.uri,
    corners: [session.frontCorner.uri, session.backCorner.uri],
  };
}
