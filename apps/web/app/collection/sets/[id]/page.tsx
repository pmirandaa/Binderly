// `/collection/sets/[id]` route — auth-gated per-set drill-down.
// `[id]` is the set UUID directly (matches T-W-BROWSE's
// `app/sets/[id]/page.tsx` URL shape). Server component so
// `dynamic = 'force-dynamic'` is honoured.

import { CollectionSetRoute } from '../../../../components/collection/CollectionSetRoute';

export const dynamic = 'force-dynamic';

interface CollectionSetPageProps {
  params: { id: string };
}

export default function CollectionSetPage({
  params,
}: CollectionSetPageProps): React.ReactNode {
  return <CollectionSetRoute setId={params.id} />;
}
