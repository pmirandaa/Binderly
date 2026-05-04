// Top-level barrel for the source adapters bundled with
// `@binderly/data-pipeline`. Each adapter task owns ONLY its
// designated section below — uncomment your re-export when your
// adapter lands. Do NOT add lines outside your section, do NOT
// remove the section headers, do NOT touch other adapters'
// sections. This keeps parallel-dispatched adapter tasks from
// conflicting on this file (same pattern as the schema barrel
// in packages/db/src/schema/index.ts).

// ============================================================
// === T-DL-SOURCE-TCGDEX-EN === (primary English)
// ============================================================
export * from './tcgdex-en/index.js';

// ============================================================
// === T-DL-SOURCE-PTCGIO === (validation; English)
// ============================================================
export * from './ptcgio/index.js';

// ============================================================
// === T-DL-SOURCE-BULBAPEDIA === (validation/filler)
// ============================================================
export * from './bulbapedia/index.js';

// ============================================================
// === T-DL-SOURCE-TCGDEX-JP === (primary Japanese)
// ============================================================
export * from './tcgdex-jp/index.js';
export * from './pokemoncard-jp/index.js';
