import { PlaceholderScreen } from './PlaceholderScreen';

import type { ReactNode } from 'react';

export function SignInScreen(): ReactNode {
  return (
    <PlaceholderScreen
      title="Sign in"
      description="Google, Apple, Discord, and magic-link auth flows land here."
      ownerTask="T-M-AUTH"
    />
  );
}
