// Auth stack. T-M-AUTH adds the real flows; the shell only
// reserves the routes so deep links (`binderly://auth/callback`)
// resolve correctly the moment the auth task lands.

import { Stack } from 'expo-router';

import type { ReactNode } from 'react';

export default function AuthLayout(): ReactNode {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="callback" />
    </Stack>
  );
}
