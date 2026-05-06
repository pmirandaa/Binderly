// Public barrel for `apps/mobile/src/lib/auth/`. Internal-to-mobile;
// not part of any cross-package public surface. Feature tasks
// (T-M-COLLECTION, T-M-CUSTOM, T-M-PROFILE, …) import from here
// rather than reaching into individual files.

export {
  OAUTH_CALLBACK_PATH,
  OAUTH_PROVIDERS,
  extractAuthCodeFromUrl,
  extractAuthErrorFromUrl,
  getOAuthRedirectUrl,
  signInWithOAuthProvider,
} from './oauth.js';
export type { OAuthProvider, OAuthSignInResult } from './oauth.js';

export { isAppleAuthAvailable, signInWithApple } from './apple.js';
export type { AppleSignInResult } from './apple.js';

export { DEFAULT_SIGN_IN_ROUTE, ProtectedScreen, useRequireAuth } from './protected-screen.js';
export type { ProtectedScreenProps } from './protected-screen.js';
