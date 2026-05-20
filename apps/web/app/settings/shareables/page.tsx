// `/settings/shareables` route — owner-side config surface for
// the public `/c/{handle}/{slug}` pages. Auth gate runs inside
// `<ShareablesSettingsRoute>` (matches `/collection`'s posture);
// middleware does not need to know about this prefix.
//
// `force-dynamic` opts the route out of static prerender so
// `next build` doesn't try to dereference `getApiClient()` →
// `loadWebEnv()` without env vars set.

import { ShareablesSettingsRoute } from './ShareablesSettingsRoute';

export const dynamic = 'force-dynamic';

export default function SettingsShareablesPage(): React.ReactNode {
  return <ShareablesSettingsRoute />;
}
