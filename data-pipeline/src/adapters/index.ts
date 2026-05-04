// Top-level barrel for the source adapters bundled with
// `@binderly/data-pipeline`. New adapters (PTCGIO, Bulbapedia, TCGdex
// JP, etc.) re-export from here so consumers can compose the resolver
// from a single import.

export * from './tcgdex-en/index.js';
