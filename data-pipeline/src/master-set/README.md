# `data-pipeline/src/master-set/` — Master-set rules engine

Pure logic that decides `printing.include_in_master_set` for every
printing of a TCG set. Consumes the variant classifier's per-printing
output (variant class, variant flags, the conservative
`include_in_master_set_default`) plus the per-set overrides stored in
`set.master_set_rules` jsonb, and returns a decision Map keyed by
`variant_key`.

This module is the **single source of truth** for what "master set"
means at write time. T-DL-SEED-INGEST writes the boolean.
T-SP-SET-COMPLETION reads the materialized boolean for completion %.

> **Why this is a separate module:** master-set membership is a
> _product_ decision (per `PROJECT.md` § 8 and Pablo's spec); the
> classifier emits a _technical_ default. The split lets product
> guidance (per-set overrides) evolve without touching adapter code,
> and lets the classifier stay opinion-free.

## Usage

```ts
import {
  decideMasterSetMembership,
  parseMasterSetRules,
  type MasterSetDecisionInput,
} from '@binderly/data-pipeline';

// Built upstream from the variant classifier output.
const printings: MasterSetDecisionInput[] = canonicalPrintings.map((cp) => ({
  variantKey: cp.variantKey,
  variantClass: cp.variantClass,
  variantFlags: cp.variantFlags,
  includeInMasterSetDefault: cp.includeInMasterSet,
}));

const { decisions, overridesApplied } = decideMasterSetMembership({
  set: { canonicalKey: set.canonicalKey, masterSetRules: set.masterSetRules },
  printings,
});

for (const printing of canonicalPrintings) {
  printing.includeInMasterSet = decisions.get(printing.variantKey)!;
}
```

Pure: same input → same output. No IO. No globals. No logging. Throws
`z.ZodError` only on a malformed `set.masterSetRules` (defense-in-depth
against corrupt jsonb).

## Precedence (highest first)

1. **Per-printing override** —
   `additional_excluded_variant_keys` / `additional_included_variant_keys`.
   Surgical and explicit; wins over toggles and defaults. **If a key
   appears in both lists, _included_ wins.** (Positive assertions over
   blanket exclusions — easier to reason about when product wants a
   single edge case re-included.)
2. **Set-level toggle** — `include_pattern_variants`,
   `include_prerelease`, `include_staff`, etc. Applies to printings
   whose class or flag matches the toggle's domain. Multiple matches
   apply in `TOGGLE_PRECEDENCE` order, last-write-wins (the order puts
   most-restrictive toggles like `include_staff`/`include_error` last
   so they dominate when they conflict with class-level inclusions).
3. **Classifier default** —
   `MasterSetDecisionInput.includeInMasterSetDefault`. The base case;
   no override fired.

## Override schema (validated by `masterSetRulesSchema`)

`.strict()` zod schema. Unknown keys throw at write time so a typo
surfaces immediately (rather than silently no-op'ing the override).

| Key                                | Default | Domain                                              |
| ---------------------------------- | ------- | --------------------------------------------------- |
| `include_textured`                 | true    | `TEXTURED` class                                    |
| `include_trainer_gallery`          | true    | `TRAINER_GALLERY` class                             |
| `include_pattern_variants`         | true    | `POKE_BALL_PATTERN` and `MASTER_BALL_PATTERN` flags |
| `include_prerelease`               | (class) | `STAMPED_PRERELEASE` flag                           |
| `include_league`                   | (class) | `STAMPED_LEAGUE` flag                               |
| `include_buildbattle`              | (class) | `STAMPED_BUILDBATTLE` flag                          |
| `include_championship`             | (class) | `STAMPED_CHAMPIONSHIP` flag                         |
| `include_staff`                    | false   | `STAMPED_STAFF` flag                                |
| `include_error`                    | false   | `ERROR` flag                                        |
| `additional_excluded_variant_keys` | `[]`    | exact `variant_key` strings                         |
| `additional_included_variant_keys` | `[]`    | exact `variant_key` strings                         |

`(class)` means "inherits the printing's class default" — i.e. for a
HOLO + `STAMPED_LEAGUE` printing, default is true (HOLO default) until
`include_league` is set.

### What's intentionally NOT in the schema

- Toggles for `HOLO` / `NON_HOLO` / `REVERSE_HOLO` / `SECRET_RARE` /
  `RAINBOW` / `GOLD` / `FULL_ART` / `ALT_ART` / `PROMO` classes —
  their defaults are stable per `tcg-domain.md` § 2 invariants. Sets
  needing surgical exclusion of a single ALT_ART use
  `additional_excluded_variant_keys`.
- `COSMOS_PATTERN` / `GALAXY_PATTERN` toggles — these patterns are
  cosmetic per Pablo's spec; the underlying class default decides.
- Glob / regex patterns on variant keys — keeps validation surface
  minimal. If a future use case needs pattern matching, escalate per
  `tasks/01-data-layer/T-DL-MASTER-SET-RULES.md` "Escalation triggers".

## Default rules table (`DEFAULT_INCLUDE_BY_CLASS`)

Mirror of `variant-classify.ts:decideMasterDefault`. Every class
default is `true`; the classifier itself flips `false` for printings
carrying `ERROR` or `STAMPED_STAFF` flags before the engine runs.

The `rules.test.ts` invariant test cross-checks this table against the
classifier so they cannot drift out of sync silently.

## Authoring per-set rules

The common case — `master_set_rules: {}` — is correct for nearly
every set. Override only when the spec or Pablo says so. Examples:

### "Vintage set; prerelease prints not part of master"

```jsonc
// set.master_set_rules
{
  "include_prerelease": false,
}
```

### "Modern set; surgically exclude a single Pokémon Center ALT_ART"

```jsonc
{
  "additional_excluded_variant_keys": ["en-swsh10-225-altart"],
}
```

### "Quirky set; force include a known error printing"

```jsonc
{
  "additional_included_variant_keys": ["en-base1-058-nonholo-err"],
}
```

### "Promo set; force-include staff stamps as part of THIS set's master"

```jsonc
{
  "include_staff": true,
}
```

## Trace output

`decideMasterSetMembership(...).overridesApplied` is a `Map` of
`variant_key → MasterSetDecisionTrace` for every printing whose final
decision **differs from its classifier default**. Default-match
printings are not in the trace (keeps it small).

Trace `reason` is one of:

- `set_toggle` — a set-level toggle fired; `toggle` field names which.
- `per_printing_excluded` — listed in `additional_excluded_variant_keys`
  and not overridden by `additional_included_variant_keys`.
- `per_printing_included` — listed in `additional_included_variant_keys`.

The trace is intended for debugging ingestion, ops dashboards, and
tests — not for runtime user UI.

## Where this fits in the pipeline

```
                  RawPrinting (adapter)
                          │
                          ▼
                 classifyVariant()
                  (variant-classify.ts)
                          │
                          ▼
       CanonicalPrinting + include_in_master_set_default
                          │
                          ▼
               decideMasterSetMembership()  ← THIS MODULE
                          │
                          ▼
                Map<variantKey, boolean>
                          │
                          ▼
   T-DL-SEED-INGEST writes printing.include_in_master_set
                          │
                          ▼
   partial index `printing_master_set_idx` powers reads
                          │
                          ▼
   T-SP-SET-COMPLETION computes per-user master %.
```

## Out of scope (explicitly)

- Database writes — owned by T-DL-SEED-INGEST.
- Per-user master-set overrides ("I want errors in my master") —
  deferred per `tcg-domain.md` § 3.
- Recomputing user-facing completion percentages — owned by
  `packages/set-completion/` (T-SP-SET-COMPLETION).
- Validating that `additional_*_variant_keys` reference real
  printings — referential integrity is T-DL-SEED-INGEST's concern at
  write time.
- Source adapters — they emit `RawPrinting`; the classifier turns
  those into `CanonicalPrinting`.

## Testing

```sh
pnpm --filter @binderly/data-pipeline test
```

Engine tests cover precedence, every set-level toggle, per-printing
overrides, idempotency, and trace correctness. Round-trip fixture
tests for Base Set, Brilliant Stars, and SWSH Black Star Promos
verify end-to-end behavior on real TCG variant configurations.
