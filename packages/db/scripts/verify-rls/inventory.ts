// The expected RLS posture, hand-derived from the merged migrations:
//
//   - 0001_users_rls.sql            → profile, subscription
//   - 0003_catalog_rls.sql          → set, card, printing
//   - 0005_collections_rls.sql      → collection_item, custom_collection,
//                                     custom_collection_item, smart_collection_rule,
//                                     shareable
//   - 0007_grading_rls.sql          → grading_submission, grading_training_sample
//   - 0009_pricing_rls.sql          → market, price_observation, price_aggregate,
//                                     fx_rate
//   - 0015_data_conflict_rls.sql    → data_conflict (service-role-only)
//
// This file is the structural source of truth for the verification script.
// Every entry has a one-line note that maps it back to its origin migration
// so a future drift between SQL and TS is easy to spot during review.
//
// Updating this inventory is a SQL-coordinated change: bump it in the same
// PR that authors a new RLS migration. The README under
// `src/migrations/rls/README.md` is the matching prose.

/** A user-facing or catalog table whose RLS posture is asserted. */
export interface ExpectedTable {
  readonly tablename: string;
  /** Plain-English summary; surfaced in failure messages. */
  readonly note: string;
}

/** A policy expected to exist on the table, exactly as the migration creates it. */
export interface ExpectedPolicy {
  readonly tablename: string;
  readonly policyname: string;
  /**
   * Command verb as `pg_policies.cmd` reports it: 'SELECT' / 'INSERT' /
   * 'UPDATE' / 'DELETE' for FOR SELECT/INSERT/UPDATE/DELETE, or 'ALL'
   * for FOR ALL. (Note: the single-letter codes 'r/a/w/d/*' live on
   * `pg_policy.polcmd`; we read from the public `pg_policies` view
   * which translates them.)
   */
  readonly cmd: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'ALL';
  /** Roles the policy applies to, alphabetically (so the assertion is order-stable). */
  readonly roles: readonly string[];
}

export const EXPECTED_TABLES: readonly ExpectedTable[] = [
  { tablename: 'profile', note: 'users — public read of every row, owner CRUD' },
  { tablename: 'subscription', note: 'users — owner SELECT, service_role write' },
  { tablename: 'set', note: 'catalog — public read, service_role write' },
  { tablename: 'card', note: 'catalog — public read, service_role write' },
  { tablename: 'printing', note: 'catalog — public read, service_role write' },
  { tablename: 'collection_item', note: 'collections — owner CRUD' },
  { tablename: 'custom_collection', note: 'collections — owner CRUD' },
  { tablename: 'custom_collection_item', note: 'collections — parent-owner CRUD' },
  { tablename: 'smart_collection_rule', note: 'collections — parent-owner CRUD' },
  { tablename: 'shareable', note: 'collections — owner CRUD + slug-gated public read' },
  { tablename: 'grading_submission', note: 'grading — owner CRUD' },
  {
    tablename: 'grading_training_sample',
    note: 'grading — service_role only (no permissive policy)',
  },
  { tablename: 'market', note: 'pricing — public read, service_role write' },
  { tablename: 'price_observation', note: 'pricing — service_role only (no permissive policy)' },
  { tablename: 'price_aggregate', note: 'pricing — public read, service_role write' },
  { tablename: 'fx_rate', note: 'pricing — public read, service_role write' },
  {
    tablename: 'data_conflict',
    note: 'admin debug — service_role only (no permissive policy)',
  },
] as const;

/**
 * Tables with RLS enabled but **no permissive policy at all**. End-user
 * sessions cannot read or write; only `service_role` (BYPASSRLS) sees them.
 */
export const NO_PERMISSIVE_POLICY_TABLES: readonly string[] = [
  'grading_training_sample',
  'price_observation',
  'data_conflict',
] as const;

/**
 * Helper: an `owner` policy 4-pack as authored by the migrations. Every
 * collections-style table follows this exact shape, so we DRY it out.
 */
function ownerCrud(tablename: string): readonly ExpectedPolicy[] {
  return [
    { tablename, policyname: `${tablename}_owner_select`, cmd: 'SELECT', roles: ['authenticated'] },
    { tablename, policyname: `${tablename}_owner_insert`, cmd: 'INSERT', roles: ['authenticated'] },
    { tablename, policyname: `${tablename}_owner_update`, cmd: 'UPDATE', roles: ['authenticated'] },
    { tablename, policyname: `${tablename}_owner_delete`, cmd: 'DELETE', roles: ['authenticated'] },
  ];
}

export const EXPECTED_POLICIES: readonly ExpectedPolicy[] = [
  // 0001_users_rls.sql ----------------------------------------------------
  ...ownerCrud('profile'),
  { tablename: 'profile', policyname: 'profile_public_read', cmd: 'SELECT', roles: ['anon'] },
  {
    tablename: 'subscription',
    policyname: 'subscription_owner_select',
    cmd: 'SELECT',
    roles: ['authenticated'],
  },
  {
    tablename: 'subscription',
    policyname: 'subscription_service_role_write',
    cmd: 'ALL',
    roles: ['service_role'],
  },

  // 0003_catalog_rls.sql --------------------------------------------------
  {
    tablename: 'set',
    policyname: 'set_public_read',
    cmd: 'SELECT',
    roles: ['anon', 'authenticated'],
  },
  {
    tablename: 'card',
    policyname: 'card_public_read',
    cmd: 'SELECT',
    roles: ['anon', 'authenticated'],
  },
  {
    tablename: 'printing',
    policyname: 'printing_public_read',
    cmd: 'SELECT',
    roles: ['anon', 'authenticated'],
  },

  // 0005_collections_rls.sql ---------------------------------------------
  ...ownerCrud('collection_item'),
  ...ownerCrud('custom_collection'),
  ...ownerCrud('custom_collection_item'),
  ...ownerCrud('smart_collection_rule'),
  ...ownerCrud('shareable'),
  {
    tablename: 'shareable',
    policyname: 'shareable_public_read_by_slug',
    cmd: 'SELECT',
    roles: ['anon', 'authenticated'],
  },

  // 0007_grading_rls.sql --------------------------------------------------
  ...ownerCrud('grading_submission'),
  // grading_training_sample: intentionally no policies; covered by
  // NO_PERMISSIVE_POLICY_TABLES above.

  // 0009_pricing_rls.sql --------------------------------------------------
  {
    tablename: 'market',
    policyname: 'market_public_read',
    cmd: 'SELECT',
    roles: ['anon', 'authenticated'],
  },
  {
    tablename: 'price_aggregate',
    policyname: 'price_aggregate_public_read',
    cmd: 'SELECT',
    roles: ['anon', 'authenticated'],
  },
  {
    tablename: 'fx_rate',
    policyname: 'fx_rate_public_read',
    cmd: 'SELECT',
    roles: ['anon', 'authenticated'],
  },
  // price_observation: intentionally no policies; covered by
  // NO_PERMISSIVE_POLICY_TABLES above.
] as const;
