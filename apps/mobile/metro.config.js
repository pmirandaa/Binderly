// Metro config for the Expo bundler.
//
// We extend Expo's default config and toggle the package-exports
// resolver flag so:
//
//   1. The pnpm workspace symlinks under `node_modules/@binderly/*`
//      resolve correctly (Metro's default symlink walker handles
//      this once package.json `exports` maps are honored).
//   2. ESM `exports` fields on the `@binderly/api-client` and
//      `@binderly/ui` packages route to the right `dist/`
//      entries.
//   3. `.tflite` files are bundled as static assets so
//      `require('./model.tflite')` resolves at runtime — the
//      `react-native-fast-tflite` binding loads from these asset
//      module IDs. (Per T-SC-EMBED-MODEL: bundle-only for v1;
//      on-device update from R2 is a follow-up.)
//
// Reference: Metro's package exports docs
// https://reactnative.dev/blog/2025/05/12/version-0.79#metro-package-exports

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.unstable_enablePackageExports = true;

// Register .tflite as a bundled asset extension. Metro's default
// assetExts list doesn't include it; without this, `require()` of a
// .tflite file fails with "unable to resolve module".
if (!config.resolver.assetExts.includes('tflite')) {
  config.resolver.assetExts = [...config.resolver.assetExts, 'tflite'];
}

module.exports = config;
