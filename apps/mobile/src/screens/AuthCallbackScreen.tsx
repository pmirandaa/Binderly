import { PlaceholderScreen } from './PlaceholderScreen';

import type { ReactNode } from 'react';

export function AuthCallbackScreen(): ReactNode {
  return (
    <PlaceholderScreen
      title="Signing in…"
      description="OAuth and magic-link callbacks resolve through this route."
      ownerTask="T-M-AUTH"
    />
  );
}
