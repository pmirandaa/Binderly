-- T-BE-AUTH — automatic profile + subscription provisioning on signup.
--
-- When a new row appears in `auth.users` (via any signup flow — Google,
-- Apple, Discord, magic link, future passwordless — they all land in
-- the same table), provision the matching application-level rows:
--
--   - public.profile       (user-facing identity, with a default handle)
--   - public.subscription  (entitlement ledger, default tier='free')
--
-- =====================================================================
-- Why a Postgres trigger and not an Edge Function or app-level lazy
-- creation
-- =====================================================================
--
--   1. ATOMIC. The profile + subscription rows are guaranteed to exist
--      by the time the auth.users INSERT transaction commits. There is
--      no race window where a freshly signed-in client can find no
--      profile (which would otherwise be especially painful in the
--      mobile sync engine, where reads happen before writes).
--
--   2. PROVIDER-AGNOSTIC. Works for every signup path without each
--      client surface re-implementing the same provisioning logic.
--      OAuth callback, magic-link verify, Edge Function-driven invite
--      flows — all converge on this single trigger.
--
--   3. SELF-HEALING. The function is idempotent (ON CONFLICT (user_id)
--      DO NOTHING). A future backfill INSERT into auth.users (e.g. a
--      `supabase db reset` followed by re-creating an existing user)
--      doesn't fail; missing rows get filled in, present rows stay
--      untouched.
--
-- The application-level `@binderly/auth#provisionProfile` helper is the
-- belt-and-braces safety net behind this trigger (see the package's
-- README). Same idempotent shape, same default handle, callable from
-- any service-role-keyed worker.
--
-- =====================================================================
-- Handle generation
-- =====================================================================
--
-- profile.handle is `citext UNIQUE NOT NULL`. We need a deterministic
-- seed that:
--   - never collides at our scale,
--   - never leaks PII (no email-prefix derivation),
--   - is stable per user (re-running the trigger generates the same
--     handle, so ON CONFLICT DO NOTHING semantics are clean),
--   - is editable by the user later via the app UI (T-W-AUTH /
--     T-M-AUTH).
--
-- We use `'u_' || first 12 hex chars of the user UUID with dashes
-- stripped` (e.g. `u_abcdef123456`). 16^12 ≈ 2.8 trillion combos —
-- collision-free at any plausible Binderly scale, and the leading
-- 12 hex of a v4 UUID has ~48 bits of entropy.
--
-- The TS-side `defaultHandleFor` helper in `@binderly/auth/profile.ts`
-- mirrors this exact format so a row created by either path is
-- indistinguishable.
--
-- =====================================================================
-- Why SECURITY DEFINER
-- =====================================================================
--
-- auth.users INSERTs are performed as the `supabase_auth_admin` role,
-- which has NO privileges on the `public` schema (by design —
-- supabase_auth_admin is the GoTrue service's role and shouldn't be
-- able to write to application data directly).
--
-- The trigger function therefore needs `SECURITY DEFINER` so it runs
-- with the privileges of its owner (`postgres`, the migration runner)
-- regardless of the calling role. The function body is fully internal
-- (no user input flows into the SQL it generates), so the standard
-- SECURITY DEFINER attack surface is mitigated by:
--
--   - Pinning `search_path = ''` inside the function (defends against
--     malicious schemas masquerading as `public.*`).
--   - Fully-qualifying every table reference (`public.profile`,
--     `public.subscription`) so the empty search_path doesn't break
--     name resolution.
--   - No dynamic SQL — every statement is a static INSERT.
--
-- =====================================================================
-- Idempotency
-- =====================================================================
--
-- Each INSERT carries `ON CONFLICT (user_id) DO NOTHING` so re-running
-- the trigger against a user whose application-level rows already
-- exist is a no-op. This matters for two flows:
--
--   1. Belt-and-braces backfill from `@binderly/auth#provisionProfile`
--      (the application-level safety net) calling the trigger's
--      function directly via `SELECT public.handle_new_user_for(uuid)`
--      (out of scope for this migration; helper added when needed).
--
--   2. `supabase db reset` re-running the seed.sql which may insert
--      synthetic auth.users rows whose matching profile/subscription
--      rows were also seeded.
--
-- =====================================================================
-- verify-rls coordination
-- =====================================================================
--
-- The verify-rls behavioral suite (`packages/db/scripts/verify-rls/`)
-- inserts synthetic auth.users rows inside its transaction to drive
-- the role matrix. With this trigger in place, those INSERTs now
-- create matching public.profile + public.subscription rows
-- automatically. The suite's existing assertions still pass; two new
-- assertions (`behavior:trigger created profile row …`, `behavior:
-- trigger created subscription row with tier=free …`) confirm the
-- trigger fired. The previously-explicit `INSERT INTO public.profile`
-- in `setupAuthFixtures` is removed in the same PR — the trigger is
-- now the canonical row creator.
--
-- =====================================================================
-- The migration
-- =====================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  generated_handle text;
BEGIN
  generated_handle := 'u_' || substr(replace(NEW.id::text, '-', ''), 1, 12);

  INSERT INTO public.profile (user_id, handle)
  VALUES (NEW.id, generated_handle)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.subscription (user_id, tier)
  VALUES (NEW.id, 'free')
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- Lock down EXECUTE so only the role that actually invokes the trigger
-- (supabase_auth_admin, when it INSERTs into auth.users) and trusted
-- service-role callers can run the function. SECURITY DEFINER means
-- the function ALWAYS runs with postgres-owner privileges regardless
-- of the caller, so this REVOKE is defense-in-depth: it stops anon /
-- authenticated end users from invoking the function via PostgREST
-- and watching the side-effects.
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin, service_role;
--> statement-breakpoint

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
--> statement-breakpoint

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
