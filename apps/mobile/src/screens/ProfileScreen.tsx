import { PlaceholderScreen } from './PlaceholderScreen';

import type { ReactNode } from 'react';

export function ProfileScreen(): ReactNode {
  return (
    <PlaceholderScreen
      title="Profile"
      description="Account, subscription, language preferences, theme override land here."
      ownerTask="T-M-AUTH"
    />
  );
}
