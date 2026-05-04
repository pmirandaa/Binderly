# TCG Domain Rules

The authoritative reference for *what cards exist*, *how they are
classified*, and *what counts toward the master set*. Every adapter and the
master-set rules engine reference this file.

---

## 1. Variant taxonomy (canonical)

Every printing has:

- `variant_class` — primary type (enum, see below)
- `variant_flags` — array of orthogonal flags (enum, can stack)
- `variant_code` — deterministic short string we assemble from class +
  flags, used in `printing.variant_key`

### `variant_class` enum

```
HOLO
NON_HOLO
REVERSE_HOLO
FULL_ART
ALT_ART          # also covers "Special Illustration Rare" / SIR
SECRET_RARE      # any card with number > printed_total
GOLD             # hyper rare
RAINBOW
TEXTURED
TRAINER_GALLERY
PROMO            # for cards in promo "sets"
```

### `variant_flags` (stack on top of class)

```
FIRST_EDITION
SHADOWLESS
UNLIMITED
POKE_BALL_PATTERN
MASTER_BALL_PATTERN
COSMOS_PATTERN
GALAXY_PATTERN
STAMPED_PRERELEASE
STAMPED_STAFF
STAMPED_LEAGUE
STAMPED_BUILDBATTLE
STAMPED_CHAMPIONSHIP
TEXTURED
ERROR              # known printing errors that are collected as variants
```

### `variant_code` assembly

`{class_short}[+{flag_short}…]` joined with `-`, sorted alphabetically by
flag. Examples:

- Base Set Charizard 1st Edition Shadowless Holo:
  `holo-fe-sl`
- Brilliant Stars Charizard VSTAR Rainbow Rare:
  `rainbow`
- SWSH Promo SWSH284 Pikachu V Master Ball Pattern:
  `nonholo-mb`
- Hidden Fates Shiny Charizard GX Secret Rare:
  `secret`

`printing.variant_key = {card.canonical_key}-{variant_code}`.

---

## 2. Master set inclusion rules

A printing has a boolean `include_in_master_set`. The default per set is
*every printing of every numbered card and every secret rare of that set is
included*. The exceptions below override.

### Always **excluded** by default

- Staff promos of a different set (`STAMPED_STAFF` where the underlying
  printing is from a different set's promo run).
- League promos generally — included only if the set's master-set rule says
  so. Pablo's intent: include them.
- Standalone promo "sets" (Black Star promos, SWSH Black Star) tracked as
  their own sets, NOT pulled into another set's master-set count. They have
  their own master-set %.

### Always **included** by default

- Reverse holos in modern sets where they are part of the set print run.
- Poké Ball pattern and Master Ball pattern reverse holos when present
  (this is Pablo's explicit ask).
- Prerelease-stamped cards from the same set's prerelease build-and-battle
  kit.
- Secret rares (numbers above printed_total).

### Per-set override

The `set` table has a JSON `master_set_rules` field. Schema:

```jsonc
{
  "include_pattern_variants": true,        // POKE_BALL_PATTERN, MASTER_BALL_PATTERN
  "include_prerelease": true,
  "include_staff": false,
  "include_league": true,
  "include_buildbattle": true,
  "include_championship": false,
  "include_textured": true,
  "include_trainer_gallery": true,
  "additional_excluded_variant_keys": [],  // explicit overrides
  "additional_included_variant_keys": []
}
```

The master set rules engine in `data-pipeline/src/master-set/` evaluates
each printing during ingestion and writes
`printing.include_in_master_set`. The engine is deterministic and
idempotent.

---

## 3. Edge cases (the painful list)

These are cases where collectors disagree and we have to pick a stance.

### Base Set: Shadowless vs Unlimited

- 1st Edition Shadowless, Shadowless, and Unlimited are **three separate
  printings** of the same card.
- Master Set for Base Set includes all three.

### Promo "sets" (Black Star, Wizards Black Star, SWSH Black Star, etc.)

- Modeled as their own `set` rows.
- Their master-set is internal to that promo set.
- Cards in a promo set sometimes mirror cards from a main set with a
  different illustration; they are distinct cards with distinct
  `canonical_key`s.

### Movie promos (Ancient Mew, etc.)

- Modeled as part of a movie-promo set or the era's Black Star set,
  whichever is canonical per source.
- Always included in their parent set's master.

### Prerelease build-and-battle stamps

- The same card with a `STAMPED_PRERELEASE` flag is a distinct printing.
- Modern sets: included in master.
- Vintage sets (where prerelease practice differed): per-set rule.

### Trainer Gallery (SWSH era)

- TG cards are a sub-set within a parent set. They share the parent's set
  code with a `TG` prefix on the number (e.g., `TG01`).
- Modeled as cards in the parent set with `variant_class=TRAINER_GALLERY`
  and number prefix `TG`.
- Included in the parent's master.

### Galarian Gallery (Crown Zenith)

- Same approach as Trainer Gallery, prefix `GG`.

### Pokemon Center stamped reprints, GameStop stamps, Costco repacks

- Distinct printings via flags. Their inclusion in master is set-by-set;
  default exclude unless the set's rules specifically include them.

### Errors and misprints (e.g., Base Set Pikachu Red Cheeks)

- Modeled with `variant_flags: [ERROR]`. **Excluded** from master by
  default. Collectors who want them in their master can flip a per-user
  override (deferred — out of MVP).

### Japanese exclusives

- Japanese sets sometimes get cards or variants the English release skips
  (e.g., Eevee Heroes alt arts).
- Tracked as Japanese cards, not English cards.
- The "All Pokémon %" metric counts EN and JP as separate cards by
  default; user can opt in to "treat languages as the same card" in
  preferences (deferred — out of MVP).

### Shining / Crystal / Shiny variants (vintage)

- These are *cards*, not variant flags. They have their own card numbers.
  *Shining Charizard* (Neo Destiny #107) is a different `card` from
  *Charizard* (Base Set #4).

### POP series, Nintendo Black Star, Wizards Black Star

- Each is its own set. Numbered separately.

### Cards reprinted across sets with the same illustration

- Two distinct cards with two distinct `canonical_key`s.
- "All Pokémon %" counts them separately by design (per Pablo's spec).

---

## 4. Set release ordering

Default sort everywhere: `set.release_date` descending. When two sets share
a date (e.g., en/jp simultaneous launches), tiebreaker is
`set.language` ('en' before 'jp') then `set.code` alphabetic.

This is THE thing Pablo hated about Collectr. Test the ordering anywhere
sets are listed. The "Latest" set must be position 1 in default browse.

---

## 5. Card identifiers (canonical keys)

```
card.canonical_key = "{language}-{set_code}-{number_padded}"
```

- `language` ∈ {`en`, `jp`, others later}
- `set_code` lowercase, no spaces (e.g., `base1`, `swsh9`, `sv1`)
- `number_padded` zero-padded to 3 (`004`, `186`). For lettered numbers
  (e.g., `TG01`), keep as-is.

```
printing.variant_key = "{canonical_key}-{variant_code}"
```

These keys are stable across data source refreshes. Do not regenerate UUIDs;
always use the canonical/variant key for cross-source joins and idempotent
upserts.

---

## 6. Rarity normalization

Sources use different rarity vocabularies. We normalize to:

```
COMMON
UNCOMMON
RARE
HOLO_RARE
ULTRA_RARE         # EX, GX, V, VMAX, ex (lowercase modern), etc.
SECRET_RARE
HYPER_RARE         # gold
RAINBOW_RARE
SPECIAL_ILLUSTRATION_RARE
ILLUSTRATION_RARE
DOUBLE_RARE        # SV-era ex
RADIANT_RARE
AMAZING_RARE
PROMO
```

Each adapter owns a mapping table from its source rarity to ours. Conflicts
between sources surface to `data_conflicts`.

---

## 7. Type normalization

Pokémon types: `GRASS, FIRE, WATER, LIGHTNING, PSYCHIC, FIGHTING, DARKNESS,
METAL, FAIRY, DRAGON, COLORLESS`.

Trainer subtypes: `ITEM, SUPPORTER, STADIUM, TOOL, POKEMON_TOOL`.

Energy subtypes: `BASIC, SPECIAL`.

---

## 8. The "Variant Decision Tree" for adapters

The decision tree below is what `data-pipeline/src/variant-classify.ts`
implements. It has been refined during T-DL-SOURCE-INTERFACES from an
earlier "secret rare wins first" formulation, because explicit visual
class signals reflect collector intuition more accurately:
**Brilliant Stars Charizard VSTAR Rainbow #174 (with `printed_total =
172`) is a `RAINBOW`, not a `SECRET_RARE`.** Secret-rare numbering
remains the primary signal *only* when no other class is asserted.

When an adapter encounters a printing of a card, evaluate these in
order. The first matching rule wins:

1. **Trainer Gallery / Galarian Gallery.** Source explicitly flags
   `isTrainerGallery` OR card number starts with `TG` / `GG` →
   `TRAINER_GALLERY`.
2. **Gold / Hyper Rare.** Source flags `isGoldRare` → `GOLD`.
3. **Rainbow Rare.** Source flags `isRainbowRare` → `RAINBOW`.
4. **Alt Art (Special Illustration Rare).** Source flags `isAltArt` →
   `ALT_ART`.
5. **Full Art.** Source flags `isFullArt` → `FULL_ART`.
6. **Textured Rare.** Source flags `isTextured` AND no other special
   class signal → `TEXTURED`. (When another class is also asserted,
   `TEXTURED` becomes a flag instead of the class.)
7. **Promo set.** Source flags `isPromo` (or the set is a known promo
   set in `normalize/set-code.ts`) → `PROMO`.
8. **Secret rare (numerical).** Card number is purely numeric AND
   `> printed_total` AND no rule above fired → `SECRET_RARE`.
9. **Reverse Holo.** Source flags `isReverseHolo` → `REVERSE_HOLO`.
   Pattern flag (Cosmos, Galaxy, Poké Ball, Master Ball) layers from
   `RawPrinting.pattern`.
10. **Holo.** Source flags `isHolo` → `HOLO`.
11. **Else** → `NON_HOLO`.

Then layer flags (orthogonal — they stack on whatever class won):

- `FIRST_EDITION` from `isFirstEdition`
- `SHADOWLESS` from `isShadowless`
- `UNLIMITED` from `extra.isUnlimited === true` (explicit only —
  vintage prints with no `isFirstEdition` / `isShadowless` are NOT
  auto-marked Unlimited; the source must say so)
- Pattern flag (`POKE_BALL_PATTERN` / `MASTER_BALL_PATTERN` /
  `COSMOS_PATTERN` / `GALAXY_PATTERN`) from `RawPrinting.pattern`
- Stamp flag (`STAMPED_PRERELEASE` / `STAMPED_STAFF` / `STAMPED_LEAGUE`
  / `STAMPED_BUILDBATTLE` / `STAMPED_CHAMPIONSHIP`) from
  `RawPrinting.stamp`
- `TEXTURED` flag when texture is reported on a non-`TEXTURED` class
- `ERROR` from `isError`

The decision tree is implemented in `data-pipeline/src/variant-classify.ts`
and unit tested per source. Every § 3 edge case has at least one named
test case.

### `include_in_master_set_default`

The classifier emits a *default* boolean for whether a printing belongs
in the master set. The master-set rules engine
(`data-pipeline/src/master-set/`, T-DL-MASTER-SET-RULES) reads this and
applies per-set overrides from `set.master_set_rules`. Defaults:

- `false` for `ERROR` flag and `STAMPED_STAFF` flag
- `true` for `SECRET_RARE`, `REVERSE_HOLO`, `TRAINER_GALLERY`, `HOLO`,
  `NON_HOLO`, `FULL_ART`, `ALT_ART`, `RAINBOW`, `GOLD`, `TEXTURED`,
  `PROMO`
