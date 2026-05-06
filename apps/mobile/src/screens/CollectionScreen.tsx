import { PlaceholderScreen } from './PlaceholderScreen';

import type { ReactNode } from 'react';

export function CollectionScreen(): ReactNode {
  return (
    <PlaceholderScreen
      title="Collection"
      description="Stats, recent additions, custom and smart collections live here."
      ownerTask="T-M-COLLECTION"
    />
  );
}
