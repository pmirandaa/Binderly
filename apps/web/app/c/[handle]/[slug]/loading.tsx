// Route-level loading boundary for `/c/[handle]/[slug]`. Next.js
// renders this while the page server component is resolving;
// since the route is `force-dynamic` the loading state is brief
// but visible on slow networks.

import { PageLoading } from '../../../../components/loading/PageLoading';

export default function ShareableLoading(): React.ReactNode {
  return <PageLoading label="Loading shareable…" />;
}
