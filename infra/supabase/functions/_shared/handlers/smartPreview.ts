// Handler for `POST /v1/smart-collections/preview`.
//
// Accepts a Smart Collection DSL expression + pagination
// (`{ expression, limit?, offset? }`) and returns matching printings
// (the projection mirrors `smartPreviewItemDto` in
// `packages/api-contracts/src/collection.ts`) plus a `totalCount`
// and `nextOffset` for the UI.
//
// Compilation strategy (Decision D5 in the elaborated task brief).
// The DSL package (`@binderly/smart-collection-dsl`) exposes
// `expressionToSql()` to compile an expression to a parameterized
// SQL WHERE clause. The Edge Function bundle does NOT pull in
// workspace packages — the deno.jsonc import-map only resolves
// `zod` and `@supabase/supabase-js`. Executing raw SQL via the
// supabase-js boundary is also constrained (PostgREST is a REST
// surface, not a SQL execution surface).
//
// We therefore take an in-memory evaluator approach:
//
//   1. Validate the incoming AST against `smartPreviewRequest`
//      (mirrored in `_shared/contracts.ts`). The mirror rejects
//      `collection.*` field references — those are owner-scoped
//      and only useful on the "save" path that joins the user's
//      `collection_item` rows. Preview is the catalog-wide
//      filter view.
//
//   2. Load the catalog projection (printing + card + set columns
//      the DSL allowlist references). At v1 catalog size
//      (~30k printings), this is a bounded ~10 MB JSON payload —
//      acceptable for a preview endpoint that returns ≤ 500 rows.
//      A future task can extract a Postgres RPC if the catalog
//      grows beyond the comfort zone (logged as Q-013).
//
//   3. Walk the AST against each candidate row. The evaluator
//      mirrors `@binderly/smart-collection-dsl`'s `evaluate.ts`;
//      the file is small and pure-data so duplicating it inside
//      the Edge Function bundle is cleaner than re-architecting
//      the import-map. Drift is bounded by the contract — we only
//      handle the leaf kinds the mirror schema accepts.
//
//   4. Sort matches by (set.release_date DESC, card.number ASC)
//      so the same expression produces a stable preview across
//      requests. Paginate with the caller's `limit` / `offset`.

import { parseJsonBody } from '../validate.ts';
import { smartPreviewRequest, type SmartPreviewField } from '../contracts.ts';
import { ApiError, apiOk } from '../errors.ts';
import { requireUser, translatePostgrestError } from '../db.ts';

import type { CorsConfig } from '../cors.ts';
import type { ClientFactoryDeps, EdgeFunctionEnv } from '../db.ts';
import type { RouteMatch } from '../routing.ts';

export interface HandlerContext {
  readonly env: EdgeFunctionEnv;
  readonly cors: CorsConfig;
  readonly requestId: string;
  readonly deps?: ClientFactoryDeps;
}

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

// ============================================================
// Candidate-row shapes
// ============================================================

interface PrintingCatalogRow {
  readonly id: string;
  readonly card_id: string;
  readonly variant_class: string;
  readonly variant_code: string;
  readonly variant_flags: readonly string[];
  readonly include_in_master_set: boolean;
  readonly image_small_url: string | null;
}

interface CardCatalogRow {
  readonly id: string;
  readonly set_id: string;
  readonly name: string;
  readonly number: string;
  readonly illustrator: string | null;
  readonly language: string;
  readonly type: string | null;
  readonly subtype: string | null;
  readonly rarity: string | null;
  readonly hp: number | null;
  readonly retreat_cost: number | null;
}

interface SetCatalogRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly series: string | null;
  readonly language: string;
  readonly release_date: string;
  readonly printed_total: number | null;
  readonly total: number | null;
}

interface Candidate {
  readonly printing: PrintingCatalogRow;
  readonly card: CardCatalogRow;
  readonly set: SetCatalogRow;
}

// ============================================================
// AST evaluator — mirrors `@binderly/smart-collection-dsl`'s
// `evaluate.ts` (only the leaf kinds the mirror schema accepts).
// ============================================================

interface AstNode {
  readonly type: 'and' | 'or' | 'not' | 'eq' | 'in' | 'range' | 'exists';
  readonly children?: readonly AstNode[];
  readonly child?: AstNode;
  readonly field?: SmartPreviewField;
  readonly value?: string | number | boolean;
  readonly values?: readonly (string | number | boolean)[];
  readonly min?: string | number;
  readonly max?: string | number;
  readonly minInclusive?: boolean;
  readonly maxInclusive?: boolean;
  readonly exists?: boolean;
}

function evaluate(expr: AstNode, candidate: Candidate): boolean {
  switch (expr.type) {
    case 'and':
      return (expr.children ?? []).every((c) => evaluate(c, candidate));
    case 'or':
      return (expr.children ?? []).some((c) => evaluate(c, candidate));
    case 'not':
      return expr.child !== undefined ? !evaluate(expr.child, candidate) : false;
    case 'eq':
      return expr.field !== undefined && expr.value !== undefined
        ? equals(getField(candidate, expr.field), expr.value, expr.field)
        : false;
    case 'in':
      return expr.field !== undefined && expr.values !== undefined
        ? expr.values.some((v) => equals(getField(candidate, expr.field!), v, expr.field!))
        : false;
    case 'range':
      return expr.field !== undefined
        ? withinRange(
            getField(candidate, expr.field),
            expr.min,
            expr.max,
            expr.minInclusive ?? true,
            expr.maxInclusive ?? true,
          )
        : false;
    case 'exists': {
      if (expr.field === undefined) return false;
      const value = getField(candidate, expr.field);
      const isPresent = value !== null && value !== undefined;
      return (expr.exists ?? true) ? isPresent : !isPresent;
    }
  }
}

function equals(
  actual: unknown,
  expected: string | number | boolean,
  field: SmartPreviewField,
): boolean {
  if (actual === null || actual === undefined) return false;
  // `enumArray` fields: equality semantics = "array contains the value".
  if (Array.isArray(actual)) {
    return actual.includes(expected);
  }
  if (typeof actual === 'number' && typeof expected === 'number') {
    return actual === expected;
  }
  if (typeof actual === 'boolean' && typeof expected === 'boolean') {
    return actual === expected;
  }
  if (typeof actual === 'string' && typeof expected === 'string') {
    // Case-insensitive comparison for free-text card.name; exact
    // for enum / set-code / language. Mirrors the search-and-add
    // UX convention.
    if (field === 'card.name' || field === 'card.illustrator' || field === 'set.name') {
      return actual.toLowerCase() === expected.toLowerCase();
    }
    return actual === expected;
  }
  return false;
}

function withinRange(
  actual: unknown,
  min: string | number | undefined,
  max: string | number | undefined,
  minInclusive: boolean,
  maxInclusive: boolean,
): boolean {
  if (actual === null || actual === undefined) return false;
  if (min !== undefined) {
    const ok = minInclusive ? (actual as number | string) >= min : (actual as number | string) > min;
    if (!ok) return false;
  }
  if (max !== undefined) {
    const ok = maxInclusive ? (actual as number | string) <= max : (actual as number | string) < max;
    if (!ok) return false;
  }
  return true;
}

function getField(candidate: Candidate, field: SmartPreviewField): unknown {
  switch (field) {
    case 'card.name':
      return candidate.card.name;
    case 'card.number':
      return candidate.card.number;
    case 'card.illustrator':
      return candidate.card.illustrator;
    case 'card.language':
      return candidate.card.language;
    case 'card.type':
      return candidate.card.type;
    case 'card.subtype':
      return candidate.card.subtype;
    case 'card.rarity':
      return candidate.card.rarity;
    case 'card.hp':
      return candidate.card.hp;
    case 'card.retreatCost':
      return candidate.card.retreat_cost;
    case 'set.code':
      return candidate.set.code;
    case 'set.name':
      return candidate.set.name;
    case 'set.series':
      return candidate.set.series;
    case 'set.language':
      return candidate.set.language;
    case 'set.releaseDate':
      return candidate.set.release_date;
    case 'set.printedTotal':
      return candidate.set.printed_total;
    case 'set.total':
      return candidate.set.total;
    case 'printing.variantClass':
      return candidate.printing.variant_class;
    case 'printing.variantFlags':
      return candidate.printing.variant_flags;
    case 'printing.variantCode':
      return candidate.printing.variant_code;
    case 'printing.includeInMasterSet':
      return candidate.printing.include_in_master_set;
  }
}

// ============================================================
// Handler entry point
// ============================================================

export async function handleSmartCollectionsPreview(
  request: Request,
  _match: RouteMatch,
  ctx: HandlerContext,
): Promise<Response> {
  const session = await requireUser(request, ctx.env, ctx.deps);
  const payload = await parseJsonBody(request, smartPreviewRequest);
  const limit = Math.min(payload.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const offset = payload.offset ?? 0;
  const expression = payload.expression as AstNode;

  // Load catalog projection. The catalog tables are public-read,
  // so the user-scoped client can hit them (RLS exposes them to
  // `authenticated` per migration `0003`). We grab everything in
  // one round trip per table — three calls total — and join in
  // memory, which avoids tying the supabase-js builder in knots
  // over deeply-nested embedded resource filters.
  const { data: printingRows, error: printingError } = await session.supabase
    .from('printing')
    .select(
      'id, card_id, variant_class, variant_code, variant_flags, include_in_master_set, image_small_url',
    );
  if (printingError !== null) throw translatePostgrestError(printingError);
  const { data: cardRows, error: cardError } = await session.supabase
    .from('card')
    .select(
      'id, set_id, name, number, illustrator, language, type, subtype, rarity, hp, retreat_cost',
    );
  if (cardError !== null) throw translatePostgrestError(cardError);
  const { data: setRows, error: setError } = await session.supabase
    .from('set')
    .select('id, code, name, series, language, release_date, printed_total, total');
  if (setError !== null) throw translatePostgrestError(setError);

  const cards = new Map<string, CardCatalogRow>();
  for (const row of (cardRows ?? []) as readonly CardCatalogRow[]) {
    cards.set(row.id, row);
  }
  const sets = new Map<string, SetCatalogRow>();
  for (const row of (setRows ?? []) as readonly SetCatalogRow[]) {
    sets.set(row.id, row);
  }

  const candidates: Candidate[] = [];
  for (const printing of (printingRows ?? []) as readonly PrintingCatalogRow[]) {
    const card = cards.get(printing.card_id);
    if (card === undefined) continue;
    const set = sets.get(card.set_id);
    if (set === undefined) continue;
    candidates.push({ printing, card, set });
  }

  // Evaluate. The mirror schema has already verified the AST
  // shape; we run any leaf-eval failures as `false` so a
  // pathological expression produces an empty result set rather
  // than a 500.
  const matches: Candidate[] = [];
  for (const candidate of candidates) {
    let result: boolean;
    try {
      result = evaluate(expression, candidate);
    } catch (cause) {
      throw new ApiError(
        'VALIDATION',
        `Failed to evaluate expression: ${cause instanceof Error ? cause.message : 'unknown'}.`,
      );
    }
    if (result) matches.push(candidate);
  }

  // Stable sort: newest set first (release_date desc); within a
  // set, by card.number ascending (lexicographic — card numbers
  // like '025/100' sort correctly enough for v1).
  matches.sort((a, b) => {
    const dateCmp = b.set.release_date.localeCompare(a.set.release_date);
    if (dateCmp !== 0) return dateCmp;
    return a.card.number.localeCompare(b.card.number);
  });

  const totalCount = matches.length;
  const pageEnd = Math.min(offset + limit, totalCount);
  const page = matches.slice(offset, pageEnd);
  const nextOffset = pageEnd < totalCount ? pageEnd : null;

  const items = page.map((c) => ({
    printingId: c.printing.id,
    cardId: c.card.id,
    setId: c.set.id,
    cardName: c.card.name,
    cardNumber: c.card.number,
    setName: c.set.name,
    setCode: c.set.code,
    variantLabel: variantLabel(c.printing),
    imageSmallUrl: c.printing.image_small_url,
  }));

  return apiOk(request, ctx.cors, ctx.requestId, {
    items,
    totalCount,
    nextOffset,
  });
}

function variantLabel(printing: PrintingCatalogRow): string {
  if (printing.variant_class === 'BASE' && printing.variant_flags.length === 0) {
    return '';
  }
  const flags = printing.variant_flags.length > 0 ? ` (${printing.variant_flags.join(', ')})` : '';
  return `${printing.variant_class}${flags}`;
}
