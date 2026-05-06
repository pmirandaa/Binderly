// Babel config for the Expo Metro bundler. Tests use Vite's
// SWC-based React plugin and never load this file.
//
// Tamagui's optimizing compiler plugin is intentionally omitted at
// this stage — the iter-13 `core+input` setup runs at runtime, and
// the optimizing pass can be added later if profiling shows the
// runtime cost matters. Adding it here would couple the shell to
// a code-shape decision that belongs in a separate task.

module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
