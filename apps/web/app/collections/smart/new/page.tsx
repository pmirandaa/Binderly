// `/collections/smart/new` — auth-gated editor. Server component
// so `dynamic = 'force-dynamic'` is honoured; the client surface
// lives in `<SmartEditorRoute>`.

import { SmartEditorRoute } from '../../../../components/collections/smart/SmartEditorRoute';

export const dynamic = 'force-dynamic';

export default function SmartCollectionEditorPage(): React.ReactNode {
  return <SmartEditorRoute />;
}
