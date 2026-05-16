// `/collections/smart/[id]` route — auth-gated saved smart-
// collection viewer. Server component for `dynamic =
// 'force-dynamic'`; client surface in `<SmartDetailRoute>`.

import { SmartDetailRoute } from '../../../../components/collections/smart/SmartDetailRoute';

export const dynamic = 'force-dynamic';

interface SmartCollectionDetailPageProps {
  params: { id: string };
}

export default function SmartCollectionDetailPage({
  params,
}: SmartCollectionDetailPageProps): React.ReactNode {
  return <SmartDetailRoute collectionId={params.id} />;
}
