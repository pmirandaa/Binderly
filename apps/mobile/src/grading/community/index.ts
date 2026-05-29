// Public barrel for the community grading-flywheel submission flow
// (T-GR-COMMUNITY-FLYWHEEL). The route file mounts
// `<CommunitySubmissionScreen>`; everything else is the pure logic the screen
// + tests share.

export {
  CommunitySubmissionScreen,
  describeSubmitError,
  type CommunitySubmissionScreenProps,
} from './screens/CommunitySubmissionScreen.js';

export {
  COMMUNITY_GRADE_COMPANIES,
  SUBGRADE_KEYS,
  emptyCommunityForm,
  type CommunityGradeCompany,
  type CommunitySubmissionForm,
  type CommunitySubmissionImages,
  type SubgradeKey,
  type SubmissionState,
} from './types.js';

export {
  isGradeOnGrid,
  normalizeCertNumber,
  validateCommunityForm,
  type ValidationOutcome,
} from './validation.js';

export { sessionToImages } from './capture-images.js';

export {
  canSubmit,
  initialSubmissionState,
  reduceSubmission,
  type SubmissionAction,
} from './submission-machine.js';
