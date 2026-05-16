// `/browse` route — set list with language / series / search
// filters. The page is a server component (no `'use client'`)
// so `dynamic = 'force-dynamic'` is honoured by Next.js; the
// real client-side surface lives in `<BrowseRoute>` which
// constructs the api-client lazily inside a `useEffect`.

import { BrowseRoute } from '../../components/browse/BrowseRoute';

// `dynamic = 'force-dynamic'` opts the route out of static
// prerender so `next build` doesn't try to render the page (and
// dereference `getApiClient()` → `loadWebEnv()`) without env
// vars set. The api-client + Supabase singletons are
// constructed only at request time inside the browser, matching
// the iter-14 W-SHELL hotfix lesson.
export const dynamic = 'force-dynamic';

export default function BrowsePage(): React.ReactNode {
  return <BrowseRoute />;
}
