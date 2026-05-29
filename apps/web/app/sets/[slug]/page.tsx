// `/sets/[slug]` route — per-set view. `[slug]` is the set's
// `canonicalKey` (e.g. `en-base1`), matching the mobile
// `/sets/[slug]` convention (#FU-64). Legacy `/sets/<uuid>` links
// still resolve: `<SetView>` detects a UUID segment, looks the set
// up by id, and redirects to its canonical slug URL.
//
// Server component (no `'use client'`) so `dynamic =
// 'force-dynamic'` is honoured. The real client-side surface
// lives in `<SetRoute>`.

import { SetRoute } from '../../../components/browse/SetRoute';

export const dynamic = 'force-dynamic';

interface SetPageProps {
  params: { slug: string };
}

export default function SetPage({ params }: SetPageProps): React.ReactNode {
  return <SetRoute slug={params.slug} />;
}
