// `/collections/custom/[id]` route — auth-gated detail view for a
// single manual custom collection. Server component (no
// `'use client'`) so `dynamic = 'force-dynamic'` is honoured; the
// real client-side surface lives in
// `<CustomCollectionDetailRoute>`, which lazy-builds the api-
// client inside a `useEffect`.

import { CustomCollectionDetailRoute } from '../../../../components/collections/custom/CustomCollectionDetailRoute';

export const dynamic = 'force-dynamic';

interface CustomCollectionDetailPageProps {
  params: { id: string };
}

export default function CustomCollectionDetailPage({
  params,
}: CustomCollectionDetailPageProps): React.ReactNode {
  return <CustomCollectionDetailRoute collectionId={params.id} />;
}
