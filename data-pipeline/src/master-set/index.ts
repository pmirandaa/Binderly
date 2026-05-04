// Public barrel for the master-set rules engine.
//
// Downstream consumers (T-DL-SEED-INGEST writes the boolean,
// T-SP-SET-COMPLETION reads it) import via the package root
// `@binderly/data-pipeline` — see `data-pipeline/src/index.ts` for
// the re-export.

export {
  decideMasterSetMembership,
  type DecideMasterSetMembershipInput,
  type DecideMasterSetMembershipResult,
  type DecideMasterSetSetInput,
  type MasterSetDecisionInput,
  type MasterSetDecisionTrace,
  type MasterSetDecisionTraceReason,
} from './decide.js';
export {
  EMPTY_MASTER_SET_RULES,
  masterSetRulesSchema,
  parseMasterSetRules,
  safeParseMasterSetRules,
  type MasterSetRulesOverrides,
} from './types.js';
export {
  classToTogglePath,
  DEFAULT_INCLUDE_BY_CLASS,
  DEFAULT_INCLUDE_BY_FLAG,
  flagToTogglePath,
  TOGGLE_PRECEDENCE,
} from './rules.js';
