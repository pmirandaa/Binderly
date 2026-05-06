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
//
// Reference: Metro's package exports docs
// https://reactnative.dev/blog/2025/05/12/version-0.79#metro-package-exports
//
// Keep this thin — the shell doesn't add custom transformers,
// asset extensions, or source maps tweaks here. Future tasks
// (T-SC-CAMERA, T-OF-LOCAL-DB) can extend this if a native module
// requires a custom transformer.

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.unstable_enablePackageExports = true;

module.exports = config;
