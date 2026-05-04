// Public barrel for @binderly/db. Stage-01 schema tasks populate
// `./schema`; the typed client lives at `./client`. Keep this file thin —
// it's the only entry point downstream consumers may import from.

export * from './client.js';
export * from './schema/index.js';
