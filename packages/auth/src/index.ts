// Public barrel for @binderly/auth. Only this file is part of the
// package's public surface — every other module is internal and
// callers must NOT reach into `@binderly/auth/src/<module>`.

export { createServiceRoleClient, createUserScopedClient, type CreateClientFn } from './clients.js';
export { AuthError, isAuthError, type AuthErrorCode, type AuthErrorJSON } from './errors.js';
export { loadAuthEnv, REQUIRED_ENV_KEYS, type EnvSource } from './env.js';
export { decodeClaims, extractBearerToken, isExpired } from './jwt.js';
export { defaultHandleFor, provisionProfile } from './profile.js';
export {
  getSessionFromRequest,
  requireUser,
  verifyAccessToken,
  type RequestLike,
  type RequireUserDeps,
} from './session.js';
export type {
  AuthClaims,
  AuthEnv,
  AuthenticatedSession,
  ProvisionedProfile,
  RequireUserOptions,
} from './types.js';
