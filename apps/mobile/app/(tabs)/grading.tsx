// Tab route — re-points to the T-GR-CAPTURE-UX guided capture
// flow now that the grading stage has opened. Same one-line
// re-point convention `app/(tabs)/scanner.tsx` used when
// T-SC-CAMERA shipped.
//
// The legacy `GradingScreen` placeholder at
// `apps/mobile/src/screens/GradingScreen.tsx` is left in place
// for stage-transition compatibility and is no longer reachable
// from the router.

import { GradingCaptureScreen } from '../../src/grading/capture/index.js';

export default GradingCaptureScreen;
