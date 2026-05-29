// Handler for `GET /v1/me/handle-available?handle=<value>` (#FU-52,
// T-BE-SHAREABLES-HANDLE-CHECK).
//
// Auth-required: the rate-limit budget is conceptually tied to the
// caller's JWT, and "is this handle free for *me* to claim?" needs to
// know who "me" is so the caller's *current* handle reports as
// available (you already own it). `requireUser()` verifies the JWT and
// hands back a user-scoped client.
//
// Response shape mirrors `handleAvailabilityResponse` in
// `@binderly/api-contracts`:
//
//   { handle, available: true }                       — free to claim
//   { handle, available: false, reason: 'taken' }     — owned by another
//   { handle, available: false, reason: 'reserved' }  — system handle
//
// The settings UI (`ProfileFields`) debounces 400 ms and renders copy
// per `reason`. The api-client (`profile.checkHandleAvailability`)
// pre-validates the handle against `shareableHandleSchema`, so a
// malformed handle normally never reaches here; we still reject one
// defensively with a VALIDATION 400 (the client surfaces that as the
// "we'll verify on save" degraded path).
//
// Read posture. The existence probe reads `profile` by `handle`
// (`citext`, so case-insensitive at the DB level). `profile` has an
// anon/public SELECT policy (0001), so the user-scoped client can see
// whether *any* user holds the handle; we then compare `user_id`
// against the caller to distinguish "yours" from "taken".

import { ApiError, apiOk } from '../errors.ts';
import { requireUser, translatePostgrestError } from '../db.ts';

import type { CorsConfig } from '../cors.ts';
import type { ClientFactoryDeps, EdgeFunctionEnv } from '../db.ts';
import type { RouteMatch } from '../routing.ts';

export interface HandlerContext {
  readonly env: EdgeFunctionEnv;
  readonly cors: CorsConfig;
  readonly requestId: string;
  readonly deps?: ClientFactoryDeps;
}

/**
 * Handle picker pattern — mirror of `SHAREABLE_HANDLE_PATTERN` in
 * `@binderly/api-contracts` (the Edge Function bundle deploys without
 * the pnpm workspace, so the contracts package is not importable at
 * runtime; this is the same self-contained-mirror posture the error
 * codes in `errors.ts` take). 3–30 chars, leading `[a-z0-9]`, then
 * `[a-z0-9-]`.
 */
const HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{2,29}$/;

/**
 * System-owned handles nobody can claim. Kept small and explicit; the
 * server is authoritative (the client just renders the `reserved`
 * copy). Lower-cased — the comparison normalizes the candidate first.
 */
const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  'admin',
  'administrator',
  'binderly',
  'support',
  'help',
  'api',
  'root',
  'system',
  'about',
  'settings',
  'login',
  'signin',
  'signup',
  'auth',
  'c',
]);

interface ProfileHandleRow {
  readonly user_id: string;
  readonly handle: string;
}

export async function handleCheckHandleAvailability(
  request: Request,
  match: RouteMatch,
  ctx: HandlerContext,
): Promise<Response> {
  const session = await requireUser(request, ctx.env, ctx.deps);

  const raw = match.searchParams.get('handle');
  if (raw === null || raw.trim().length === 0) {
    throw new ApiError('VALIDATION', 'Missing required `handle` query parameter.');
  }
  const candidate = raw.trim().toLowerCase();

  // Defensive shape check. The api-client pre-validates, so a request
  // that reaches here with a bad handle is a stale page or a direct
  // caller; a 400 is the honest answer (the response contract requires
  // `handle` itself to be pattern-valid, so we can't echo a bad one).
  if (!HANDLE_PATTERN.test(candidate)) {
    throw new ApiError(
      'VALIDATION',
      'Handle must be 3–30 chars: lowercase letters, numbers, or hyphens, no leading hyphen.',
    );
  }

  if (RESERVED_HANDLES.has(candidate)) {
    return apiOk(request, ctx.cors, ctx.requestId, {
      handle: candidate,
      available: false,
      reason: 'reserved',
    });
  }

  const { data, error } = await session.supabase
    .from('profile')
    .select('user_id, handle')
    .eq('handle', candidate)
    .maybeSingle();
  if (error !== null) throw translatePostgrestError(error);

  // No row → nobody holds it → free to claim.
  if (data === null) {
    return apiOk(request, ctx.cors, ctx.requestId, { handle: candidate, available: true });
  }

  const row = data as ProfileHandleRow;
  // You already own it — "available" so the settings UI renders the
  // green "looks good" affordance even before the user edits anything.
  if (row.user_id === session.user.id) {
    return apiOk(request, ctx.cors, ctx.requestId, { handle: candidate, available: true });
  }

  return apiOk(request, ctx.cors, ctx.requestId, {
    handle: candidate,
    available: false,
    reason: 'taken',
  });
}
