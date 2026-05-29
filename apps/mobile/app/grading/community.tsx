// Stack route — community grading-flywheel submission screen
// (T-GR-COMMUNITY-FLYWHEEL).
//
// Reachable after a capture/centering session (the capture review + centering
// screens push here with `?sessionId=<id>`) so the user can submit the real
// graded outcome of the card they just captured. The `sessionId` resolves the
// already-captured shots from the shared session store; the screen reuses those
// photos as the submission's image references. Without a session the screen
// still renders and prompts the user to capture photos first.
//
// The flow is pro-gated inside `<CommunitySubmissionScreen>` (see its header for
// the gating-path decision).

import { useLocalSearchParams } from 'expo-router';
import { type ReactNode } from 'react';

import { getSession } from '../../src/grading/centering/index.js';
import {
  CommunitySubmissionScreen,
  sessionToImages,
} from '../../src/grading/community/index.js';

export default function CommunitySubmissionRoute(): ReactNode {
  const params = useLocalSearchParams<{ sessionId?: string }>();
  const sessionId = typeof params.sessionId === 'string' ? params.sessionId : undefined;
  const session = sessionId !== undefined ? getSession(sessionId) : undefined;

  return (
    <CommunitySubmissionScreen
      capturedImages={session !== undefined ? sessionToImages(session) : undefined}
    />
  );
}
