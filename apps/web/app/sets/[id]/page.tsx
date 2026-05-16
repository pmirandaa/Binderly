// `/sets/[id]` route — per-set view. `[id]` is the set UUID
// directly; a future task can introduce a friendlier slug + a
// `getSetBySlug()` endpoint without changing the URL shape
// (the `[id]` segment is opaque to consumers).
//
// Server component (no `'use client'`) so `dynamic =
// 'force-dynamic'` is honoured. The real client-side surface
// lives in `<SetRoute>`.

import { SetRoute } from '../../../components/browse/SetRoute';

export const dynamic = 'force-dynamic';

interface SetPageProps {
  params: { id: string };
}

export default function SetPage({ params }: SetPageProps): React.ReactNode {
  return <SetRoute setId={params.id} />;
}
