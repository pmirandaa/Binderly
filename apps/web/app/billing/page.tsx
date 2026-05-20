// `/billing` route — auth-gated. The actual surface lives in
// `<BillingRoute>` which constructs the api-client lazily inside a
// `useEffect`, mirroring `/collection`'s pattern from T-W-COLLECTION.
//
// `force-dynamic` is essential here: the underlying components
// touch `getApiClient()` → `loadWebEnv()` which throws when
// `NEXT_PUBLIC_SUPABASE_URL` isn't set. Static prerender during
// `next build` runs without those env vars (CI builds aren't
// supposed to set them), so opting out of static generation
// keeps the build green.

import { BillingRoute } from './BillingRoute';

export const dynamic = 'force-dynamic';

export default function BillingPage(): React.ReactNode {
  return <BillingRoute />;
}
