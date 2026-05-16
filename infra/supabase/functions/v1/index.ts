// Binderly v1 Edge Function — single-mux for `/v1/me/...` writes.
//
// Deployed to Supabase as the function named `v1`. Production URL:
// `${SUPABASE_URL}/functions/v1/v1/me/...`. The api-client calls
// `${baseUrl}/v1/me/...` directly; a thin reverse-proxy rewrite
// (`/v1/*` → `/functions/v1/v1/*`) bridges the two in production.
// For local dev the CLI accepts the function URL directly; see the
// adjacent `README.md` § Local dev.
//
// This file is the entry-point only — all routing logic lives in
// `_shared/dispatch.ts`, all routes live in `_shared/routes-table.ts`,
// and the per-resource handlers live in `_shared/handlers/*.ts`. The
// motivation is testability: the handler returned by `makeHandler`
// is just `(Request) => Promise<Response>` and can be exercised
// directly from vitest without booting Deno.

// deno-lint-ignore-file no-explicit-any

import { makeHandler } from '../_shared/dispatch.ts';
import { ROUTES } from '../_shared/routes-table.ts';

// `Deno.serve` exists in Supabase's Edge Runtime (Deno 2.x). When
// running under Node + vitest this whole file is intentionally NOT
// imported — tests reach into `_shared/dispatch.ts` directly.
declare const Deno:
  | { env: { get: (name: string) => string | undefined }; serve: (handler: any) => void }
  | undefined;

if (typeof Deno !== 'undefined') {
  const handler = makeHandler({
    getEnv: (name) => Deno!.env.get(name),
    routes: ROUTES,
  });
  Deno.serve(handler);
}

// Re-export for non-Deno consumers (e.g. live-deploy harnesses, the
// vitest integration tests) so they don't need to reach into the
// shared layer to obtain the wired handler.
export { makeHandler, ROUTES };
