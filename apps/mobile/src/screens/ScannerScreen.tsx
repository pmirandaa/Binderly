import { PlaceholderScreen } from './PlaceholderScreen';

import type { ReactNode } from 'react';

export function ScannerScreen(): ReactNode {
  return (
    <PlaceholderScreen
      title="Scan"
      description="Continuous-mode card scanning lands here. Camera permission scaffolding only at this stage."
      ownerTask="T-SC-CAMERA"
    />
  );
}
