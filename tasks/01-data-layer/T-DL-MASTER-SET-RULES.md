# T-DL-MASTER-SET-RULES — Master set rules engine

**Stage:** 01-data-layer
**Agent role:** data
**Effort:** M
**Status:** in_progress

---

## Hard dependencies

- T-DL-SCHEMA-CARDS (merged) — `printing.include_in_master_set` boolean
  and partial index `printing_master_set_idx` already exist on `main`.
  `set.master_set_rules jsonb` already exists.
- T-DL-SOURCE-INTERFACES (merged, PR #19, 51b3727) — provides:
  - `data-pipeline/src/types.ts` — `CanonicalSet`, `CanonicalCard`,
    `CanonicalPrinting`, `VariantClass`, `VariantFlag` enums + zod
    schemas.
  - `data-pipeline/src/variant-classify.ts` — `classifyVariant()`
    returning `{ variant_class, variant_flags, variant_code,
    include_in_master_set_default }`.
  - `data-pipeline/src/canonical-keys.ts` — `canonicalSetKey`,
    `canonicalCardKey`, `printingVariantKey`.

## Soft dependencies

_(none — owns_paths is exclusive: `data-pipeline/src/master-set/`.)_

## Required reading

- `PROJECT.md` § 8 (Master Set Definition) — Pablo's spec: master =
  every printing of every numbered card + secret rares + background
  variants (Poké Ball / Master Ball patterns).
- `context/tcg-domain.md` § 1 (variant taxonomy), § 2 (master-set
  inclusion rules + `master_set_rules` jsonb shape), § 3 (edge cases),
  § 8 (variant decision tree + `include_in_master_set_default`
  defaults).
- `context/data-model.md` — `set.master_set_rules jsonb`,
  `printing.include_in_master_set boolean`.
- `rules/01-data-layer.md` — stage rules; idempotency + pure-function
  hard rules.
- `data-pipeline/src/variant-classify.ts` — the upstream classifier.
  This engine NEVER re-classifies; it only decides "given this
  classification, include in master set?".
- `data-pipeline/README.md` — package architecture and "what this
  package is NOT" (no DB writes; that's T-DL-SEED-INGEST).
- `packages/db/src/schema/sets.ts`, `packages/db/src/schema/printings.ts`
  — the columns this engine ultimately drives.

## Goal

Ship a pure, deterministic, idempotent rules engine that decides
`printing.include_in_master_set` for every printing of a set. The
engine consumes the variant classifier's per-printing output (variant
class + flags + the conservative `include_in_master_set_default`) and
the per-set overrides stored in `set.master_set_rules` jsonb, and
returns a `Map<variantKey, boolean>` decision map. The engine is the
single source of truth for what "master set" means; downstream
T-DL-SEED-INGEST wires it to writes and T-SP-SET-COMPLETION reads the
materialized boolean for completion math.

This task owns the *logic*, not the *write*. The engine takes data in,
returns decisions out.

## Architecture

```
                    ┌────────────────────────┐
                    │  variant-classify.ts   │  (upstream, T-DL-SOURCE-INTERFACES)
                    │  per-printing default  │
                    └───────────┬────────────┘
                                │ include_in_master_set_default
                                ▼
   set.master_set_rules ──►  ┌────────────────────────┐
   (per-set overrides,       │  decideMasterSet…      │  (this task)
    validated by zod)        │  Pure function         │
                             └───────────┬────────────┘
                                         │
                                         ▼
                       Map<variantKey, boolean>
                                         │
                                         ▼
                  T-DL-SEED-INGEST writes printing.include_in_master_set
```

### Precedence (highest first)

1. **Per-printing override** (`additional_excluded_variant_keys` /
   `additional_included_variant_keys` in `set.master_set_rules`).
   Surgical, explicit; wins everything. If a `variantKey` appears in
   both lists, *included* wins (positive assertions are more
   trustworthy than blanket exclusions).
2. **Set-level flag/class toggles** (`include_pattern_variants`,
   `include_prerelease`, `include_staff`, `include_league`,
   `include_buildbattle`, `include_championship`, `include_textured`,
   `include_trainer_gallery`, `include_error`). When a printing matches
   a toggle's domain (carries that flag, or its class is the toggle's
   target), the toggle's value replaces the result. Multiple matches
   are applied in a fixed precedence order (documented below); later
   toggles override earlier ones.
3. **Classifier default** (`include_in_master_set_default` from
   `classifyVariant()`). Conservative base reflecting § 2's "always
   included / always excluded" invariants.

### Toggle precedence within set-level rules

When a printing matches multiple set-level toggles (e.g. a textured
trainer-gallery printing, or a staff-stamped pattern reverse holo),
toggles apply in this fixed order with later overriding earlier:

```
1. include_textured           (class-level)
2. include_trainer_gallery    (class-level)
3. include_pattern_variants   (flag-level: POKE_BALL_PATTERN, MASTER_BALL_PATTERN)
4. include_prerelease         (flag-level: STAMPED_PRERELEASE)
5. include_league             (flag-level: STAMPED_LEAGUE)
6. include_buildbattle        (flag-level: STAMPED_BUILDBATTLE)
7. include_championship       (flag-level: STAMPED_CHAMPIONSHIP)
8. include_staff              (flag-level: STAMPED_STAFF)
9. include_error              (flag-level: ERROR)
```

Rationale: more restrictive defaults (`include_staff`, `include_error`)
sit at the bottom so they win when set against a class-level
inclusion. In practice these rarely co-occur; the order keeps behavior
predictable when they do. Per-printing overrides exist for the cases
the per-set toggles can't model.

### Override schema (locked, as canonicalized in tcg-domain.md § 2)

All keys optional; missing keys fall back to the classifier default.
Validated by the `masterSetRulesSchema` zod schema this task ships;
the schema is `.strict()` (unknown keys are rejected at write time).

```ts
type MasterSetRulesOverrides = {
  // Class-level toggles
  include_textured?: boolean;            // TEXTURED class
  include_trainer_gallery?: boolean;     // TRAINER_GALLERY class

  // Flag-level toggles
  include_pattern_variants?: boolean;    // POKE_BALL_PATTERN | MASTER_BALL_PATTERN
                                         //   (Pablo's explicit inclusion ask)
  include_prerelease?: boolean;          // STAMPED_PRERELEASE
  include_league?: boolean;              // STAMPED_LEAGUE
  include_buildbattle?: boolean;         // STAMPED_BUILDBATTLE
  include_championship?: boolean;        // STAMPED_CHAMPIONSHIP
  include_staff?: boolean;               // STAMPED_STAFF
  include_error?: boolean;               // ERROR

  // Surgical overrides — variant_key strings
  additional_excluded_variant_keys?: string[];
  additional_included_variant_keys?: string[];
};
```

Notes on the locked shape:

- The schema **does not** include toggles for HOLO / NON_HOLO /
  REVERSE_HOLO / SECRET_RARE / RAINBOW / GOLD / FULL_ART / ALT_ART /
  PROMO classes. Their classifier defaults are stable across all sets
  per § 2's invariants; sets that need to surgically remove a single
  alt-art (e.g. an ultra-rare Pokémon Center exclusive) use
  `additional_excluded_variant_keys`.
- COSMOS_PATTERN and GALAXY_PATTERN are **not** governed by
  `include_pattern_variants` (they're cosmetic background patterns on
  promos, not master-set-defining variants per Pablo's spec). Their
  master-set inclusion is determined by the underlying class default.
- `additional_*_variant_keys` accept full `variant_key` strings (e.g.
  `en-base1-004-holo-fe-sl`), not loose patterns. No regex support;
  globs would balloon the validation surface and we'd need to escalate
  for product input. If a future use case needs pattern matching we
  add a new field; this one stays explicit.

## Deliverables

All paths under `data-pipeline/src/master-set/`:

1. **`types.ts`** — `MasterSetRulesOverrides` TypeScript type +
   `masterSetRulesSchema` zod `.strict()` schema. Exports a
   `parseMasterSetRules(value: unknown): MasterSetRulesOverrides`
   helper that parses-or-throws, plus a
   `safeParseMasterSetRules(value: unknown)` mirror for callers that
   want to recover. Also exports `EMPTY_MASTER_SET_RULES` constant for
   the default-empty case.
2. **`rules.ts`** — Default rules table + small helpers:
   - `DEFAULT_INCLUDE_BY_CLASS: Readonly<Record<VariantClass, boolean>>`
     — mirror of the classifier's class-level defaults, exported for
     downstream reference (T-SP-SET-COMPLETION docs / debugging).
   - `DEFAULT_INCLUDE_BY_FLAG: Readonly<Partial<Record<VariantFlag,
     boolean>>>` — only flags that *force* an outcome (ERROR → false,
     STAMPED_STAFF → false; everything else inherits its class
     default).
   - Pure helper `flagToTogglePath(flag: VariantFlag): keyof
     MasterSetRulesOverrides | null` — maps a printing's flag to the
     override toggle that governs it (`POKE_BALL_PATTERN →
     include_pattern_variants`, etc.).
   - Pure helper `classToTogglePath(cls: VariantClass): keyof
     MasterSetRulesOverrides | null` — maps a class to its toggle
     (`TEXTURED → include_textured`, etc.).
3. **`decide.ts`** — The engine:
   ```ts
   export interface DecideMasterSetMembershipInput {
     set: Pick<CanonicalSet, 'canonicalKey' | 'masterSetRules'>;
     printings: ReadonlyArray<MasterSetDecisionInput>;
   }
   export interface MasterSetDecisionInput {
     variantKey: string;
     variantClass: VariantClass;
     variantFlags: ReadonlyArray<VariantFlag>;
     includeInMasterSetDefault: boolean;
   }
   export interface DecideMasterSetMembershipResult {
     decisions: Map<string, boolean>; // variantKey → include
     overridesApplied: Map<string, MasterSetDecisionTrace>;
   }
   export interface MasterSetDecisionTrace {
     finalValue: boolean;
     reason:
       | 'classifier_default'
       | 'set_toggle'    // includes which toggle won
       | 'per_printing_excluded'
       | 'per_printing_included';
     toggle?: keyof MasterSetRulesOverrides;
   }
   export function decideMasterSetMembership(
     input: DecideMasterSetMembershipInput,
   ): DecideMasterSetMembershipResult;
   ```
   Pure: same input → same output, no IO, no globals, no side effects.
   Logs nothing. Throws only on schema-invalid `set.masterSetRules`
   (caller is expected to have validated upstream; this is a
   defense-in-depth assert).
4. **`index.ts`** — Public barrel; exports
   `decideMasterSetMembership`, the input/output types,
   `MasterSetRulesOverrides`, `masterSetRulesSchema`,
   `parseMasterSetRules`, `safeParseMasterSetRules`,
   `EMPTY_MASTER_SET_RULES`, `DEFAULT_INCLUDE_BY_CLASS`,
   `DEFAULT_INCLUDE_BY_FLAG`. Re-exported from
   `data-pipeline/src/index.ts` so downstream consumers say
   `import { decideMasterSetMembership } from '@binderly/data-pipeline'`.
5. **Tests**:
   - `types.test.ts` — `masterSetRulesSchema` accepts the documented
     shape, rejects unknown keys (`.strict()`), rejects non-boolean
     values, accepts empty `{}`, accepts every individual toggle in
     isolation, and round-trips through `parseMasterSetRules`.
   - `rules.test.ts` — every `VariantClass` enum value has an entry in
     `DEFAULT_INCLUDE_BY_CLASS`; the table matches the classifier's
     `decideMasterDefault` (cross-checked by importing
     `classifyVariant` and feeding minimal stubs).
     `flagToTogglePath` / `classToTogglePath` exhaustively cover the
     enum (compile-time + runtime).
   - `decide.test.ts` (the bulk):
     - Empty rules → every printing gets its classifier default.
     - `include_pattern_variants: false` → POKE_BALL_PATTERN and
       MASTER_BALL_PATTERN reverse holos flip to false.
     - `include_pattern_variants: true` (explicit) → matches default
       (no-op for normal patterns; relevant only when a per-printing
       override flipped them off — ensures toggle is reapplied
       last-write-wins).
     - `include_staff: true` → STAMPED_STAFF printings flip to true.
     - `include_staff: false` (default) → STAMPED_STAFF excluded
       (matches classifier default).
     - `include_textured: false` → TEXTURED-class printings flip to
       false (regardless of underlying class default).
     - `include_trainer_gallery: false` → TRAINER_GALLERY-class
       printings flip to false.
     - Per-printing exclusion wins over set-level inclusion.
     - Per-printing inclusion wins over set-level exclusion.
     - Per-printing inclusion wins over per-printing exclusion when a
       key is in BOTH lists (documented precedence).
     - Idempotency: calling `decideMasterSetMembership` twice with the
       same input yields equal Maps (deep-equal).
     - Pure: no globals modified between calls (run on shuffled inputs;
       results stable).
     - Trace correctness: `overridesApplied` records the right reason
       for each printing whose final value differs from the classifier
       default (and ONLY for those — no noise for default-match cases).
   - `fixtures/base-set.ts` + `fixtures/brilliant-stars.ts` +
     `fixtures/swsh-promos.ts` — hand-curated representative sets
     including:
     - **Base Set** (`en-base1`): Charizard 1st-Edition Shadowless Holo
       + Shadowless Holo + Unlimited Holo (three distinct printings, all
       master-included), a non-holo card, an Energy card, a known error
       (Pikachu Red Cheeks → ERROR-flagged → excluded).
     - **Brilliant Stars** (`en-swsh9`): a regular HOLO, a REVERSE_HOLO,
       Charizard VSTAR Rainbow #174 (RAINBOW class, master-included), a
       SECRET_RARE numbered above printed_total, an ALT_ART, a
       TRAINER_GALLERY (TG01), a TG REVERSE_HOLO.
     - **SWSH Black Star Promos** (`en-swshp`): Pikachu V Master Ball
       Pattern (NON_HOLO + MASTER_BALL_PATTERN flag, master-included by
       Pablo's explicit ask via `include_pattern_variants: true`
       default), a STAMPED_STAFF pseudo-promo (excluded by default).
   - `decide.fixtures.test.ts` — runs each fixture set through the
     engine with default rules and asserts the decision map matches
     the hand-curated expected master-set list documented in the
     fixture.

6. **`README.md`** — Engine overview (precedence diagram, default
   table, override schema with one example per knob, pointer to
   `tcg-domain.md` § 2 as the canonical product spec). One example of
   per-printing overrides for the surgical use case. Pointer to
   `T-DL-SEED-INGEST` for the write side and `T-SP-SET-COMPLETION` for
   the read side. Stays under 300 lines per `conventions.md`.

## Default rules table (locked)

Per-class default (mirror of `variant-classify.ts:decideMasterDefault`):

| `variant_class`     | Default include? | Notes                             |
| ------------------- | ---------------- | --------------------------------- |
| HOLO                | true             | Standard set printing             |
| NON_HOLO            | true             | Standard set printing             |
| REVERSE_HOLO        | true             | Includes pattern variants         |
| FULL_ART            | true             | Modern alt-rarity tier            |
| ALT_ART             | true             | SIR / Special Illustration Rare   |
| SECRET_RARE         | true             | Numbers > printed_total           |
| GOLD                | true             | Hyper Rare                        |
| RAINBOW             | true             | Rainbow Rare                      |
| TEXTURED            | true             | Modern textured rares             |
| TRAINER_GALLERY     | true             | TG / GG sub-set                   |
| PROMO               | true             | Promo set master is its own set   |

Per-flag forced overrides (override class default when present):

| `variant_flag`        | Forces include? | Notes                                 |
| --------------------- | --------------- | ------------------------------------- |
| ERROR                 | false           | Misprints; `include_error` overrides  |
| STAMPED_STAFF         | false           | Different-set staff promos            |
| _(all other flags)_   | _(inherit)_     | Class default applies                 |

Sets typically ship `master_set_rules: {}` (empty) — defaults are
correct for the common case. Per-set jsonb overrides exist for the
few sets where Pablo's product call differs (e.g. a vintage set
where prerelease prints are NOT included; or a set where a specific
illustrator-misprint variant IS included for that set's master).

## Acceptance criteria

- [ ] `data-pipeline/src/master-set/{index,types,rules,decide}.ts`
      exist and compile under `pnpm --filter @binderly/data-pipeline
      typecheck`.
- [ ] `decideMasterSetMembership` is a pure function: same inputs →
      same outputs (proved by an idempotency test that calls it twice
      and deep-compares the Maps).
- [ ] Every `VariantClass` enum value has a default in
      `DEFAULT_INCLUDE_BY_CLASS` (proved by a test iterating
      `VARIANT_CLASSES`).
- [ ] Every `VariantFlag` enum value has either a forced override in
      `DEFAULT_INCLUDE_BY_FLAG` or `null` in
      `flagToTogglePath` / no-op in the engine (proved by a test
      iterating `VARIANT_FLAGS`).
- [ ] `masterSetRulesSchema` is `.strict()` and validates the locked
      shape: rejects unknown keys, rejects non-boolean toggles,
      rejects non-string entries in the per-printing arrays.
- [ ] `parseMasterSetRules({})` returns `EMPTY_MASTER_SET_RULES`
      (deep-equal).
- [ ] Per-printing exclusion wins over per-printing inclusion is
      DOCUMENTED but inverted (inclusion wins) — pick ONE and lock it
      in tests + README. Locked: **inclusion wins** (positive
      assertions over blanket exclusions). Tested.
- [ ] Set-level toggle precedence order is the documented one
      (textured → trainer_gallery → pattern → prerelease → league →
      buildbattle → championship → staff → error). Tested with a
      multi-flag printing.
- [ ] Hand-curated fixture sets (Base Set, Brilliant Stars, SWSH Black
      Star Promos) pass end-to-end: every printing's expected master-
      set membership matches the engine's decision map.
- [ ] `pnpm --filter @binderly/data-pipeline test typecheck lint
      format:check build` exits 0.
- [ ] No file modified outside `data-pipeline/src/master-set/` AND
      `data-pipeline/src/index.ts` (the latter only to add the barrel
      re-export — surgical, ≤ 5 lines added). If the variant
      classifier needs a fix, surgical edits to
      `data-pipeline/src/variant-classify.ts` are explicitly allowed
      with documentation in the PR body.
- [ ] Test count ≥ 25 (rules table coverage + schema validation +
      engine logic + fixtures).
- [ ] The package README and the new
      `data-pipeline/src/master-set/README.md` cross-link.

## Out of scope

- Database writes. T-DL-SEED-INGEST owns wiring this engine's output
  to `printing.include_in_master_set` upserts via `@binderly/db`.
- Recomputing user-facing completion percentages. T-SP-SET-COMPLETION
  reads the materialized `printing.include_in_master_set` for that.
- Per-user master-set overrides ("I want errors in my master"). § 3
  notes this is deferred out of MVP.
- Validating that `additional_*_variant_keys` reference real printings.
  The engine can't see the broader catalog; T-DL-SEED-INGEST validates
  referential integrity at write time.
- Source adapters. They emit `RawPrinting`, the classifier turns those
  into `CanonicalPrinting`, and this engine consumes the canonical.
- Promo-set master rules (PROMO class). Promo "sets" tracked as their
  own `set` rows per § 3; their master-set is internal. The engine
  treats PROMO printings the same as any other class — the PROMO
  parent set's `master_set_rules` jsonb governs them.

## Branch & PR

- Branch: `agent/T-DL-MASTER-SET-RULES`
- PR title: `T-DL-MASTER-SET-RULES: Master-set rules engine`
- Commit format: Conventional Commits.

## Escalation triggers

Append to `open-questions.md` and STOP if:

- The variant classifier output is missing a signal needed for a
  master-set decision (e.g. a flag that should drive inclusion but the
  classifier doesn't emit). Propose the classifier patch in the
  open-question; the surgical cross-task edit is allowed but should be
  flagged for orchestrator review.
- The default rules table is ambiguous for a real TCG variant (e.g.
  Pablo hasn't decided whether GameStop-stamped reprints are master-
  included for a specific set). Master-set membership IS a product
  decision; do not guess.
- A user case can't be modeled with the locked override schema and
  needs more expressive matching (regex, glob, set-of-set-codes). The
  schema stays minimal; pick the simplest extension and document the
  cost tradeoff.
- A change is needed outside `owns_paths` other than the documented
  `data-pipeline/src/index.ts` barrel re-export and (allowed) surgical
  classifier patch.

## Notes from execution

_(empty until the sub-agent runs)_
