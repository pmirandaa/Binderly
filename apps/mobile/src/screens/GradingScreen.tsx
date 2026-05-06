import { PlaceholderScreen } from './PlaceholderScreen';

import type { ReactNode } from 'react';

export function GradingScreen(): ReactNode {
  return (
    <PlaceholderScreen
      title="Grading"
      description="BGS-style multi-shot capture and prediction lands here."
      ownerTask="T-GR-CAPTURE-FLOW"
    />
  );
}
