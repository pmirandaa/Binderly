// Shared Prettier configuration for the Binderly monorepo.
//
// Pinned by T-FN-LINT-CONFIG:
//   - 100-column lines
//   - single quotes
//   - trailing commas everywhere ES allows them
//   - explicit semicolons
//   - always parenthesise arrow-function params (eg. `(x) => x`)
//
// Consumers reference this config via the `prettier` field in their
// package.json:
//
//   { "prettier": "@binderly/prettier-config" }

/** @type {import('prettier').Config} */
const config = {
  printWidth: 100,
  singleQuote: true,
  trailingComma: 'all',
  semi: true,
  arrowParens: 'always',
};

export default config;
