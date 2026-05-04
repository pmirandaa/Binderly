// `decideMasterSetMembership` — the master-set rules engine.
//
// Pure function. Takes a set's per-printing classifier output and the
// per-set overrides stored in `set.master_set_rules`, returns a
// decision Map (`variant_key → boolean`) plus a per-printing trace
// for any printing whose final value DIFFERS from the classifier
// default.
//
// Precedence (highest first):
//
//   1. Per-printing override (`additional_excluded_variant_keys` /
//      `additional_included_variant_keys`). Inclusion wins on collision.
//   2. Set-level toggle (matched by class via `classToTogglePath` or
//      by flag via `flagToTogglePath`). Multiple matches apply in
//      `TOGGLE_PRECEDENCE` order, last-write-wins.
//   3. Classifier default (`includeInMasterSetDefault`). The base case;
//      no override fired.
//
// The function is the single source of truth for "given the catalog
// and this set's rules, what is `printing.include_in_master_set`?".
// T-DL-SEED-INGEST writes the boolean using this function's output;
// T-SP-SET-COMPLETION reads the materialized boolean for completion %.

import { classToTogglePath, flagToTogglePath, TOGGLE_PRECEDENCE } from './rules.js';
import { parseMasterSetRules, type MasterSetRulesOverrides } from './types.js';

import type { CanonicalSet, VariantClass, VariantFlag } from '../types.js';

/**
 * Per-printing input to the engine. Caller derives this from the
 * variant classifier's output — `variantKey` from
 * `printingVariantKey()`, the rest from `classifyVariant()`.
 */
export interface MasterSetDecisionInput {
  /** `printing.variant_key` — the upsert anchor. */
  readonly variantKey: string;
  /** Class from `classifyVariant().variant_class`. */
  readonly variantClass: VariantClass;
  /** Flags from `classifyVariant().variant_flags`. */
  readonly variantFlags: ReadonlyArray<VariantFlag>;
  /** `classifyVariant().include_in_master_set_default` — the base. */
  readonly includeInMasterSetDefault: boolean;
}

/**
 * The set side of the engine input. Only the fields the engine
 * actually reads — keeps the function easy to call from callers that
 * have synthesized a partial set (tests, ad-hoc tooling).
 */
export type DecideMasterSetSetInput = Pick<CanonicalSet, 'canonicalKey' | 'masterSetRules'>;

/**
 * The full engine input: the set whose printings we are deciding for,
 * plus the per-printing data from the classifier. The engine never
 * peeks at `card`/`set` data beyond `set.masterSetRules` — variant
 * classification is the upstream concern.
 */
export interface DecideMasterSetMembershipInput {
  readonly set: DecideMasterSetSetInput;
  readonly printings: ReadonlyArray<MasterSetDecisionInput>;
}

/**
 * Why a printing's final value differs from the classifier default.
 * Only populated for printings whose final differs from default — the
 * trace stays small and informative.
 */
export type MasterSetDecisionTraceReason =
  | 'classifier_default'
  | 'set_toggle'
  | 'per_printing_excluded'
  | 'per_printing_included';

export interface MasterSetDecisionTrace {
  readonly variantKey: string;
  readonly finalValue: boolean;
  readonly reason: MasterSetDecisionTraceReason;
  /** Set when `reason === 'set_toggle'`. */
  readonly toggle?: keyof MasterSetRulesOverrides;
}

export interface DecideMasterSetMembershipResult {
  /** `variant_key → include_in_master_set` for every input printing. */
  readonly decisions: Map<string, boolean>;
  /**
   * Trace for every printing whose final differs from the classifier
   * default. Empty when defaults are correct for the entire set.
   * Iteration order matches the order printings were passed in.
   */
  readonly overridesApplied: Map<string, MasterSetDecisionTrace>;
}

/**
 * Decide `include_in_master_set` for every printing of a set.
 *
 * Pure: same input → same output. No IO, no globals, no logging. The
 * function is safe to call from anywhere in the pipeline.
 *
 * Throws `z.ZodError` if `set.masterSetRules` is malformed JSON
 * relative to `masterSetRulesSchema`. Callers that want soft-failure
 * should validate upstream with `safeParseMasterSetRules`.
 */
export function decideMasterSetMembership(
  input: DecideMasterSetMembershipInput,
): DecideMasterSetMembershipResult {
  const overrides = parseMasterSetRules(input.set.masterSetRules);

  const excluded = new Set(overrides.additional_excluded_variant_keys ?? []);
  const included = new Set(overrides.additional_included_variant_keys ?? []);

  const decisions = new Map<string, boolean>();
  const overridesApplied = new Map<string, MasterSetDecisionTrace>();

  for (const printing of input.printings) {
    const decision = decideOne(printing, overrides, excluded, included);
    decisions.set(printing.variantKey, decision.finalValue);

    if (decision.reason !== 'classifier_default') {
      overridesApplied.set(printing.variantKey, decision);
    }
  }

  return { decisions, overridesApplied };
}

interface InternalDecision {
  readonly variantKey: string;
  readonly finalValue: boolean;
  readonly reason: MasterSetDecisionTraceReason;
  readonly toggle?: keyof MasterSetRulesOverrides;
}

function decideOne(
  printing: MasterSetDecisionInput,
  overrides: MasterSetRulesOverrides,
  excluded: ReadonlySet<string>,
  included: ReadonlySet<string>,
): InternalDecision {
  // ----- Precedence 1: per-printing overrides -----
  // Inclusion wins on collision; documented in the task spec / README.
  if (included.has(printing.variantKey)) {
    return {
      variantKey: printing.variantKey,
      finalValue: true,
      reason: 'per_printing_included',
    };
  }
  if (excluded.has(printing.variantKey)) {
    return {
      variantKey: printing.variantKey,
      finalValue: false,
      reason: 'per_printing_excluded',
    };
  }

  // ----- Precedence 2: set-level toggles -----
  // Walk TOGGLE_PRECEDENCE in order; each toggle whose domain matches
  // the printing AND whose value is set replaces the result.
  // Last-write-wins across multiple matches.
  const matchedToggles = collectMatchingToggles(printing);

  let result = printing.includeInMasterSetDefault;
  let firingToggle: keyof MasterSetRulesOverrides | undefined;

  for (const togglePath of TOGGLE_PRECEDENCE) {
    if (!matchedToggles.has(togglePath)) continue;
    const value = overrides[togglePath];
    if (typeof value !== 'boolean') continue;
    result = value;
    firingToggle = togglePath;
  }

  if (firingToggle !== undefined && result !== printing.includeInMasterSetDefault) {
    return {
      variantKey: printing.variantKey,
      finalValue: result,
      reason: 'set_toggle',
      toggle: firingToggle,
    };
  }

  // ----- Precedence 3: classifier default -----
  return {
    variantKey: printing.variantKey,
    finalValue: printing.includeInMasterSetDefault,
    reason: 'classifier_default',
  };
}

/**
 * Collect every override toggle that applies to a printing — by
 * its class (via `classToTogglePath`) and by each flag (via
 * `flagToTogglePath`). Returns a `Set` so duplicates collapse (e.g.
 * a printing with both POKE_BALL_PATTERN and MASTER_BALL_PATTERN —
 * which doesn't really happen, but the dedup keeps the engine
 * predictable).
 */
function collectMatchingToggles(
  printing: MasterSetDecisionInput,
): ReadonlySet<keyof MasterSetRulesOverrides> {
  const matches = new Set<keyof MasterSetRulesOverrides>();
  const classToggle = classToTogglePath(printing.variantClass);
  if (classToggle !== null) matches.add(classToggle);
  for (const flag of printing.variantFlags) {
    const flagToggle = flagToTogglePath(flag);
    if (flagToggle !== null) matches.add(flagToggle);
  }
  return matches;
}
