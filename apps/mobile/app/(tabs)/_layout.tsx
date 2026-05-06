// Bottom-tab navigator. Five tabs per `rules/05-mobile.md` —
// Browse, Collection, Scan (visually centred), Grading, Profile.
// Icons are intentionally text-only at this stage; T-M-AUTH /
// T-M-BROWSE / etc. wire real `lucide-react-native` icons through
// `@binderly/ui`'s `<Icon as={...} />` registry pattern.

import { Tabs } from 'expo-router';

import type { ReactNode } from 'react';

export default function TabLayout(): ReactNode {
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="browse" options={{ title: 'Browse' }} />
      <Tabs.Screen name="collection" options={{ title: 'Collection' }} />
      <Tabs.Screen name="scanner" options={{ title: 'Scan' }} />
      <Tabs.Screen name="grading" options={{ title: 'Grading' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
