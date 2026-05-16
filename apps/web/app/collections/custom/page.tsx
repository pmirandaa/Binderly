// `/collections/custom` route — auth-gated manual custom-collection
// list (free-tier 3-cap with upsell). Server component (no
// `'use client'`) so `dynamic = 'force-dynamic'` is honoured; the
// real client-side surface lives in `<CustomCollectionsRoute>`,
// which constructs the api-client lazily inside a `useEffect`.

import { CustomCollectionsRoute } from '../../../components/collections/custom/CustomCollectionsRoute';

// Opt out of static prerender so `next build` doesn't try to
// dereference `getApiClient()` → `loadWebEnv()` without env vars
// set. Mirrors `apps/web/app/collection/page.tsx` (T-W-COLLECTION)
// + `apps/web/app/browse/page.tsx` (T-W-BROWSE / iter-14 W-SHELL
// hotfix).
export const dynamic = 'force-dynamic';

export default function CustomCollectionsPage(): React.ReactNode {
  return <CustomCollectionsRoute />;
}
