// `@binderly/api-contracts` — public barrel.
//
// External consumers (web, mobile, scanner, edge functions,
// shareable SSR) MUST import from this entry point. Deep
// imports like `@binderly/api-contracts/cards` are not exposed
// in the package.json `exports` map; tree-shaking handles the
// dead-code elimination.
//
// Modules are organized by domain — see the README for the
// module map and the elaboration decisions (D2) for the
// rationale.

export * from './common.js';
export * from './cards.js';
export * from './collection.js';
export * from './pricing.js';
export * from './grading.js';
export * from './shareables.js';
export * from './auth.js';
export * from './entitlements.js';
