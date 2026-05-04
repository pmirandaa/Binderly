// Fixture builders for the collection-related tables.
//
// Each function returns a deterministic-with-overrides `New<Table>`
// value suitable for `db.insert(<table>).values(make<Table>())`. The
// builders apply sane defaults so test code only specifies the fields
// it actually cares about.
//
// Tests do not yet live alongside these fixtures — the round-trip
// test infrastructure (Dockerized Postgres + vitest harness) is owned
// by `T-DL-DB-TEST-INFRA` and was deferred during T-DL-SCHEMA-CARDS
// for the same reason. When that lands, integration tests covering:
//
//   * collection_item: NULLS NOT DISTINCT acceptance / rejection of
//     duplicate raw cards, FK cascade from `auth.users` delete,
//     unique-constraint behaviour across (condition, grade)
//     permutations.
//   * custom_collection: kind CHECK constraint rejects `'foo'`,
//     accepts `'manual'` and `'smart'`. (user_id, slug) uniqueness.
//   * custom_collection_item: cascade on parent delete, composite PK
//     idempotency.
//   * smart_collection_rule: 1:1 with parent, cascade on parent
//     delete.
//   * shareable: target jsonb CHECK rejects bad `kind`, accepts both
//     branches; (user_id, slug) uniqueness; public-read RLS.
//
// will live in `packages/db/__test__/collections.test.ts` and consume
// these factories. Each factory accepts an `overrides` partial so
// tests can pin a subset of fields without re-stating the rest.
//
// Implementation notes:
// - We intentionally do NOT generate UUIDs in the factory defaults.
//   UUIDs come from the DB (`gen_random_uuid()`) on insert; tests
//   either insert and read back the row to get the id, or pass an
//   explicit `id` override when they need a deterministic value.
// - `userId` and `printingId` are required arguments rather than
//   defaulted because the row is meaningless without an owning user
//   and a target printing — defaulting them to a sentinel UUID would
//   hide test-setup bugs. Tests must thread the real ids through.
// - The `make*` naming matches typical fixture-builder conventions in
//   the broader TS ecosystem (e.g. nestjs/effect-ts test helpers).

import type {
  NewCollectionItem,
  NewCustomCollection,
  NewCustomCollectionItem,
  NewShareable,
  NewSmartCollectionRule,
} from '../schema/index.js';

export interface MakeCollectionItemArgs {
  readonly userId: string;
  readonly printingId: string;
  readonly overrides?: Partial<NewCollectionItem>;
}

/**
 * Build a `New<CollectionItem>` with sensible defaults: quantity 1,
 * NEAR_MINT raw card with no grading company, manual source. Override
 * `condition`, `gradeCompany`, `grade`, etc. to exercise the narrow
 * unique-constraint paths.
 */
export function makeCollectionItem(args: MakeCollectionItemArgs): NewCollectionItem {
  return {
    userId: args.userId,
    printingId: args.printingId,
    quantity: 1,
    condition: 'NEAR_MINT',
    gradeCompany: null,
    grade: null,
    acquiredAt: null,
    acquiredPrice: null,
    acquiredCurrency: null,
    notes: null,
    photoUrls: [],
    source: 'manual',
    ...args.overrides,
  };
}

export interface MakeCustomCollectionArgs {
  readonly userId: string;
  readonly slug: string;
  readonly overrides?: Partial<NewCustomCollection>;
}

/**
 * Build a `New<CustomCollection>`. Defaults `kind` to `'manual'` (the
 * 3-per-free-user surface) and `name` to a humanized form of `slug`.
 */
export function makeCustomCollection(args: MakeCustomCollectionArgs): NewCustomCollection {
  return {
    userId: args.userId,
    name: humanize(args.slug),
    slug: args.slug,
    kind: 'manual',
    description: null,
    coverUrl: null,
    ...args.overrides,
  };
}

export interface MakeCustomCollectionItemArgs {
  readonly customCollectionId: string;
  readonly printingId: string;
  readonly overrides?: Partial<NewCustomCollectionItem>;
}

/**
 * Build a `New<CustomCollectionItem>`. `addedAt` defaults to the DB
 * (`now()`); pass an override when the test needs a deterministic
 * timestamp.
 */
export function makeCustomCollectionItem(
  args: MakeCustomCollectionItemArgs,
): NewCustomCollectionItem {
  return {
    customCollectionId: args.customCollectionId,
    printingId: args.printingId,
    ...args.overrides,
  };
}

export interface MakeSmartCollectionRuleArgs {
  readonly customCollectionId: string;
  readonly overrides?: Partial<NewSmartCollectionRule>;
}

/**
 * Build a `New<SmartCollectionRule>` with a placeholder DSL
 * expression. The shape `{op: 'and', clauses: []}` is a no-op that
 * stage-3 validation will accept (an empty AND matches everything);
 * tests that exercise rule semantics should pass a richer expression
 * via `overrides`.
 */
export function makeSmartCollectionRule(args: MakeSmartCollectionRuleArgs): NewSmartCollectionRule {
  return {
    customCollectionId: args.customCollectionId,
    expression: { op: 'and', clauses: [] },
    lastEvaluatedAt: null,
    ...args.overrides,
  };
}

export type ShareableTarget =
  | { readonly kind: 'full' }
  | { readonly kind: 'custom'; readonly custom_collection_id: string };

export interface MakeShareableArgs {
  readonly userId: string;
  readonly slug: string;
  readonly target?: ShareableTarget;
  readonly overrides?: Partial<NewShareable>;
}

/**
 * Build a `New<Shareable>`. Defaults `target` to `{kind: 'full'}` (the
 * "share my entire collection" surface). For a "share a specific
 * custom collection" shareable, pass `target: {kind: 'custom',
 * custom_collection_id: ...}`. The boolean show_* defaults match the
 * spec defaults declared on the column.
 */
export function makeShareable(args: MakeShareableArgs): NewShareable {
  return {
    userId: args.userId,
    slug: args.slug,
    target: args.target ?? { kind: 'full' },
    theme: 'default',
    showValues: false,
    showMissing: true,
    showPhotos: false,
    ...args.overrides,
  };
}

function humanize(slug: string): string {
  return slug
    .split('-')
    .map((part) => (part.length === 0 ? part : part[0]!.toUpperCase() + part.slice(1)))
    .join(' ');
}
