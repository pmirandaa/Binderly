# Glossary — Pokémon TCG terminology

Definitions used throughout the codebase. Where multiple collector-community
terms exist, we adopt one and stick to it.

## Core entities

- **Set** — a published collection of cards with a release date, a code, and
  a logo. Examples: *Base Set* (1999), *Brilliant Stars* (2022), *VSTAR
  Universe* (Japanese, 2022).
- **Series** — a multi-set era. *Sword & Shield series*, *Scarlet & Violet
  series*, *Sun & Moon series*. We store this on `set.series`.
- **Block** — Japan-only sometimes-used term for sub-eras. We do not model
  this; series is enough.
- **Card** — a logical card identified by `(set, number, language)`. Pikachu
  #58 of Base Set EN is one card; Pikachu #58 of Base Set JP is a different
  card.
- **Printing** — a specific physical version of a card. *Base Set Charizard
  #4* has at least: 1st Edition Shadowless Holo, Shadowless Holo, Unlimited
  Holo. Each is a separate printing.
- **Variant** — synonymous with printing in collector-speak. We always say
  "printing" in code; "variant" only appears in user-facing copy when more
  natural.

## Variant / printing types

These are normalized as enum values on `printing.variant_class`.

- **HOLO** — full holographic foil background.
- **NON_HOLO** — standard, no holo treatment.
- **REVERSE_HOLO** ("RH") — holo treatment applied to the non-illustration
  area of an otherwise non-holo card. Modern sets typically have a reverse
  holo of every common/uncommon/rare. Backgrounds vary (Cosmos, Galaxy, Poké
  Ball, Master Ball patterns).
- **POKE_BALL_PATTERN** — reverse holo background pattern depicting Poké
  Balls. Master-set relevant.
- **MASTER_BALL_PATTERN** — reverse holo background pattern depicting Master
  Balls. Rarer than Poké Ball pattern. Master-set relevant.
- **FULL_ART** — illustration extends to card edges. Often a chase rarity.
- **ALT_ART** — alternative illustration of the same card; usually a special
  rarity tier. Includes "Special Illustration Rare" / "SIR".
- **SECRET_RARE** — a card numbered above the printed total of the set
  (e.g., #186/185).
- **GOLD** ("Hyper Rare") — gold-colored secret rare treatment.
- **RAINBOW** — rainbow foil treatment.
- **TEXTURED** — additional surface texturing (modern era).
- **TRAINER_GALLERY** — dedicated TG sub-set in some SWSH-era sets.
- **PROMO** — a card distributed outside a numbered main set (movie promos,
  pack promos, league promos, prerelease, staff). Also a `set` of its own
  that we model.
- **FIRST_EDITION** — vintage stamp on the bottom-left or center of the
  card.
- **SHADOWLESS** — vintage Base Set printing without the drop shadow on the
  art frame. Distinct printing from unlimited.
- **UNLIMITED** — vintage non-1st-edition, post-shadowless print run.
- **STAMPED** — generic flag for staff/prerelease/league/build-and-battle/
  championship stamps. Free-text or enum sub-flag.

A printing can have **multiple flags** — e.g. *1st Edition Shadowless Holo*
is `variant_class=HOLO` with flags `FIRST_EDITION` and `SHADOWLESS`.

## Set metadata terms

- **Printed total** — number printed on cards (e.g., "57/102"). The 102
  here.
- **Total** — actual total including secret rares.
- **Set code** — short identifier (e.g., `swsh9` for Brilliant Stars,
  `base1` for Base Set).
- **Symbol** — small icon distinguishing the set on each card. We store its
  image.

## Conditions (for owned cards)

User can record the condition of any owned printing:

- `MINT` — looks pack-fresh.
- `NEAR_MINT` — minor wear.
- `EXCELLENT` — visible wear, no creasing.
- `GOOD` — moderate wear, possible minor creases.
- `LIGHT_PLAYED` — visible play wear.
- `PLAYED` — significant wear.
- `POOR` — heavy wear, damage.

Default new-add is `NEAR_MINT`.

## Grading terms

- **PSA** — Professional Sports Authenticator. 1–10 integer scale.
- **BGS** — Beckett Grading Services. 1–10 with 0.5 increments and
  sub-grades for centering/corners/edges/surface.
- **CGC** — Certified Guaranty Company. Similar to BGS.
- **Pristine 10 / Black Label** — top-tier BGS designation requiring 10s
  across all sub-grades.
- **Subgrade** — a 0.0–10.0 score for one of *centering*, *corners*,
  *edges*, *surface*.
- **Cert / cert number** — unique ID on every graded slab.

## Collection completion terms

- **Set %** — fraction of the numbered cards in a set that the user owns
  ≥1 printing of. Variant-agnostic.
- **Master Set %** — fraction of all printings in a set flagged
  `include_in_master_set` that the user owns ≥1 of.
- **All Pokémon %** — global fraction of unique numbered cards owned across
  every set. (Owning the holo of Charizard from Base Set + the non-holo of
  Charizard from Hidden Fates counts as 2.)
- **Master %** — global fraction of master-set-included printings owned.

## User-facing language conventions

- "Cards" in user copy means logical cards unless context demands "printing"
  (e.g., variant chips on the card detail page).
- "Set" never abbreviated in copy. "SWSH" only as a filter chip label.
- "Reverse holo" preferred over "RH" in copy. "RH" only in dense filter UIs.
- "Pokémon" with the accent in user copy. ASCII "Pokemon" only in file
  names, internal IDs, and machine-readable strings.
