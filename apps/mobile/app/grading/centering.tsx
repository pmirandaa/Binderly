// Stack route — real centering result screen.
//
// The capture review screen pushes here after the user completes the
// four-shot capture flow:
//
//   router.push(`/grading/centering?sessionId=${emitted.id}`)
//
// The session (with its 4 photo URIs) lives in the module-scoped store
// in `src/grading/centering/session-store.ts`; only the lightweight
// `sessionId` string travels in the URL.
//
// This route REPLACES the placeholder at `app/grading/capture/review.tsx`
// (which rendered `GradingCaptureReviewScreen`).  The capture review route
// still exists for the "Back" navigation path.

import { CenteringScreen } from '../../src/grading/centering/index.js';

export default CenteringScreen;
