// Stack route — placeholder review surface for the post-capture
// handoff. The tab route at `app/(tabs)/grading.tsx` pushes here
// after the fourth accepted shot.
//
// This route file is replaced (or made a no-op) when
// T-GR-CENTERING ships the real centering screen at the same URL.
// Until then we render the placeholder review screen from
// `src/grading/capture/screens/`.

import { GradingCaptureReviewScreen } from '../../../src/grading/capture/index.js';

export default GradingCaptureReviewScreen;
