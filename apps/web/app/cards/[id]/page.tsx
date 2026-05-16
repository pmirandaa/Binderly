// `/cards/[id]` route — per-printing detail view. `[id]` is a
// printing UUID despite the `/cards/` URL: the brief calls it
// "/cards/" because users think of them as cards, but the
// underlying entity is a printing (so we can render set + card +
// variant context in one fetch via `getPrinting()`).
//
// Server component so `dynamic = 'force-dynamic'` is honoured.

import { CardRoute } from '../../../components/browse/CardRoute';

export const dynamic = 'force-dynamic';

interface CardPageProps {
  params: { id: string };
}

export default function CardPage({ params }: CardPageProps): React.ReactNode {
  return <CardRoute printingId={params.id} />;
}
