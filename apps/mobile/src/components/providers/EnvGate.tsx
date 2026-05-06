// Boot-time env validation gate. Renders the children only when
// every required `EXPO_PUBLIC_*` key is set; otherwise renders a
// deterministic fallback screen listing the missing keys. Keeps a
// missing-config build from crashing the JS bundle on first import.

import { Text, YStack } from '@binderly/ui';

import { tryLoadMobileEnv, type MobileEnv, type MobileEnvError } from '../../lib/env';

import type { ReactNode } from 'react';

export interface EnvGateProps {
  children: (env: MobileEnv) => ReactNode;
  /**
   * Optional override for the `process.env` source. Tests pass an
   * explicit object; production uses the default.
   */
  source?: Readonly<Record<string, string | undefined>>;
  /**
   * Optional override for the missing-env fallback. Defaults to the
   * built-in `<EnvFallback>` component.
   */
  fallback?: (error: MobileEnvError) => ReactNode;
}

export function EnvGate(props: EnvGateProps): ReactNode {
  const result = props.source !== undefined ? tryLoadMobileEnv(props.source) : tryLoadMobileEnv();
  if (result.ok) return props.children(result.env);
  return props.fallback ? props.fallback(result.error) : <EnvFallback error={result.error} />;
}

function EnvFallback({ error }: { error: MobileEnvError }): ReactNode {
  return (
    <YStack
      flex={1}
      gap="$4"
      padding="$6"
      alignItems="center"
      justifyContent="center"
      backgroundColor="$background"
    >
      <Text variant="title" tone="default">
        Configuration error
      </Text>
      <Text variant="body" tone="muted">
        Binderly cannot start because required environment variables are missing:
      </Text>
      <YStack gap="$2" alignItems="center">
        {error.missing.map((key) => (
          <Text key={key} variant="monospace">
            {key}
          </Text>
        ))}
      </YStack>
      <Text variant="bodySmall" tone="muted">
        Copy `apps/mobile/.env.example` to `apps/mobile/.env.local` and restart the bundler.
      </Text>
    </YStack>
  );
}
