// Babel config for the Expo Metro bundler. Tests use Vite's
// SWC-based React plugin and never load this file.
//
// Tamagui's optimizing compiler plugin is intentionally omitted at
// this stage — the iter-13 `core+input` setup runs at runtime, and
// the optimizing pass can be added later if profiling shows the
// runtime cost matters. Adding it here would couple the shell to
// a code-shape decision that belongs in a separate task.
//
// Plugin ordering rules (T-SC-CAMERA):
//   - `react-native-worklets-core/plugin` is required by
//     react-native-vision-camera v4's frame-processor JSI runtime.
//     It transforms `'worklet'`-directive functions so they can run
//     on the worklets thread. The plugin is a no-op for the rest of
//     the app's code.
//   - `react-native-reanimated/plugin` (added when Reanimated is
//     used at the call-site rather than only as a transitive dep)
//     **must always be listed last**. We do not list it explicitly
//     yet because no current screen uses Reanimated worklets;
//     T-SC-UX or whichever task introduces them adds it then.

module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-worklets-core/plugin'],
  };
};
