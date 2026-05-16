// `/collection` route — auth-gated collection home (global badge +
// per-set rollups). Server component (no `'use client'`) so
// `dynamic = 'force-dynamic'` is honoured; the real client-side
// surface lives in `<CollectionRoute>` which constructs the api-
// client lazily inside a `useEffect`.

import { CollectionRoute } from '../../components/collection/CollectionRoute';

// `force-dynamic` opts the route out of static prerender so
// `next build` doesn't try to dereference `getApiClient()` →
// `loadWebEnv()` without env vars set. Matches T-W-BROWSE's
// `app/browse/page.tsx` (iter-14 W-SHELL hotfix).
export const dynamic = 'force-dynamic';

export default function CollectionPage(): React.ReactNode {
  return <CollectionRoute />;
}
