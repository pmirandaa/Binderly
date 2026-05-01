# Stage 05 — Mobile App rules

Expo SDK with development builds. The mobile-only features (scanner,
grading, offline) live in their own stages — this stage covers shell,
navigation, and parity surfaces with web.

## Required reading

- `PROJECT.md` § 10 (Core App Features), § 11 (Scanner overview), § 15
  (Offline)
- `context/conventions.md`
- `context/tech-stack.md` § Mobile app

## Hard rules

- **Development builds, not Expo Go.** We use vision-camera and
  fast-tflite which require native modules.
- **iOS + Android parity is mandatory for shipped surfaces.** Anything
  that can't reach parity gets escalated, not shipped one-platform-only.
- **Tamagui or shared `packages/ui`, never raw RN components for
  primitives.** Buttons, text, inputs all come from the shared package.
- **No platform-conditional logic in screens.** If iOS and Android
  diverge, that's a `packages/ui` concern (the component variant), not
  a screen concern.
- **Async storage minimal.** State that needs to persist goes through
  the SQLite/MMKV layer (T-OF-LOCAL-DB in stage 09). Don't sprinkle
  AsyncStorage calls.
- **Image rendering uses `expo-image`.** Caching matters in a card
  app.
- **Navigation via expo-router** (file-based, similar to Next.js App
  Router). No React Navigation hand-rolled stacks.
- **Bottom-tab structure**: Browse, Collection, Scan (center, larger),
  Grading, Profile. Adjust labels but stick to 5.

## Conventions specific to this stage

- Screens in `apps/mobile/src/screens/<feature>/<screen>.tsx`. Routing
  files in `apps/mobile/app/` per expo-router conventions.
- Use `react-native-reanimated` for animations; never the legacy
  Animated API for new code.
- Camera usage: only inside scanner / grading stages. The shell just
  reserves the route and the permission scaffolding.

## Common pitfalls

- expo-router and expo-camera have version interdependencies; pin via
  Expo SDK version.
- iOS Apple Sign In requires a build with the right entitlement;
  T-M-AUTH spells out the EAS profile.
- Android `INTERNET` permission is implicit; camera and storage are
  not.
- Hot reload breaks on native modules; restarts are normal.

## Done when

- Mobile app shell launches on iOS sim and Android emulator in dev
  builds.
- All four auth flows work mobile.
- Browse, set, card detail, collection home, custom collection screens
  render with real data from the dev Supabase.
- Free vs Pro gating respects the same rules as web.
