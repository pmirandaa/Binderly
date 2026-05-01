// Self-lint config: the package's own source files are linted with the
// base preset. Kept separate from `index.js` so consumers importing
// `@binderly/eslint-config` get the preset, while ESLint running inside
// this package's directory finds its config the standard way.

import baseConfig from './index.js';

export default baseConfig;
