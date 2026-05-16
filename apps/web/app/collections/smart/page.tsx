// `/collections/smart` route — auth-gated smart-collection home.
// Server component (no `'use client'`) so `dynamic =
// 'force-dynamic'` is honoured; the real client-side surface
// lives in `<SmartListRoute>` which constructs the api-client
// lazily inside a `useEffect`.

import { SmartListRoute } from '../../../components/collections/smart/SmartListRoute';

// `force-dynamic` opts the route out of static prerender so
// `next build` doesn't try to dereference `getApiClient()` ->
// `loadWebEnv()` without env vars set. Matches T-W-COLLECTION's
// `app/collection/page.tsx` (iter-14 W-SHELL hotfix).
export const dynamic = 'force-dynamic';

export default function SmartCollectionsPage(): React.ReactNode {
  return <SmartListRoute />;
}
