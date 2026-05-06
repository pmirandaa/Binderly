import { Stack } from 'expo-router';

import { NotFoundScreen } from '../src/screens/NotFoundScreen';

import type { ReactNode } from 'react';

export default function NotFoundRoute(): ReactNode {
  return (
    <>
      <Stack.Screen options={{ title: 'Not found' }} />
      <NotFoundScreen />
    </>
  );
}
