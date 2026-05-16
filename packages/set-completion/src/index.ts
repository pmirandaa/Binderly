// `@binderly/set-completion` — public barrel.
//
// External consumers (the edge-function recompute worker, the web
// app's optimistic-recompute hook, the mobile app's progress bars)
// MUST import from this entry point. Deep imports like
// `@binderly/set-completion/set-pct` are not exposed in the
// package.json `exports` map.
//
// The package is pure logic — no IO, no DB, no HTTP — so every
// export is either a function or a type.

export { computeSetPct, type ComputeSetPctInput } from './set-pct.js';
export { computeMasterSetPct, type ComputeMasterSetPctInput } from './master-pct.js';
export { computeAllPokemonPct, type ComputeAllPokemonPctInput } from './all-pokemon-pct.js';
export { computeGlobalMasterPct, type ComputeGlobalMasterPctInput } from './global-master-pct.js';
export { computeCompletion } from './aggregate.js';

export type {
  AllPokemonPctResult,
  ComputeCompletionInput,
  ComputeCompletionResult,
  GlobalCompletionResult,
  GlobalMasterPctResult,
  MasterSetPctResult,
  OwnedPrintingIds,
  RosterCard,
  RosterPrinting,
  SetCompletionResult,
  SetPctResult,
} from './types.js';
