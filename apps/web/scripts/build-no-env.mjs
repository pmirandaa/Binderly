// Build-with-no-env smoke guard (#FU-11).
//
// `next build` statically prerenders pages, evaluating module-scope
// and render-time code for every route. If any of that code eagerly
// reads a `NEXT_PUBLIC_*` / Supabase env var (or constructs a client
// that throws when one is missing), the production build breaks even
// though local dev — where `.env.local` is present — looks fine. This
// is exactly the class of bug that slipped through once before (the
// AuthProvider eagerly constructed the Supabase client at render time;
// see status.md follow-up #11), surfacing only in CI where no env is
// set.
//
// This guard reproduces that environment deterministically: it strips
// every build-inlined env var from the child process and asserts
// `next build` still exits 0. The lazy-init pattern (Supabase client
// built inside an effect / on first call) is what keeps it green.
//
// Run locally before pushing:  pnpm --filter @binderly/web build:no-env

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Strip everything Next inlines at build time plus any server-side
// Supabase keys, so the build cannot lean on a developer's local env.
// Mirrors CI, which never provisions these.
const env = { ...process.env };
const stripped = [];
for (const key of Object.keys(env)) {
  if (key.startsWith('NEXT_PUBLIC_') || key.startsWith('SUPABASE_')) {
    delete env[key];
    stripped.push(key);
  }
}

console.log(
  stripped.length > 0
    ? `[build-no-env] stripped ${stripped.length} env var(s): ${stripped.join(', ')}`
    : '[build-no-env] no NEXT_PUBLIC_* / SUPABASE_* env vars present (clean room)',
);

// `next` resolves off the npm-script PATH (node_modules/.bin is
// prepended by pnpm when this runs as the `build:no-env` script).
const result = spawnSync('next', ['build'], {
  cwd: webRoot,
  stdio: 'inherit',
  env,
  shell: false,
});

if (result.error) {
  console.error('[build-no-env] failed to launch `next build`:', result.error.message);
  process.exit(1);
}

if (result.status !== 0) {
  console.error(
    `[build-no-env] FAILED — apps/web did not build with no env (exit ${result.status}). ` +
      'A module-scope or render-time read of a missing env var is the usual cause; ' +
      'defer it to an effect / first-use call (lazy init).',
  );
  process.exit(result.status ?? 1);
}

console.log('[build-no-env] OK — apps/web builds with no env present.');
