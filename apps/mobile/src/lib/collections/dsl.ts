// DSL helpers for the smart-collection editor.
//
// The Smart Collection DSL is a JSON-shaped expression tree (see
// `@binderly/smart-collection-dsl`). This module wraps the package's
// `parseExpression` / `evaluateExpression` / `explainExpression`
// surface for the on-device editor:
//
//   - `parseDslText(text)` — accepts a free-text JSON payload from
//     the editor's `<Input>` and returns a discriminated-union
//     parse result. Distinguishes "you forgot to fill anything in"
//     (empty), "your JSON is malformed", and "your JSON is valid
//     but the DSL rejected it" so the UI can surface the right
//     hint.
//   - `evaluateAgainstCatalog(expr, catalog, ownedPrintingIds)` —
//     iterates a fetched catalog of printings (the Run preview
//     uses the first 200 cards from `useSetsQuery` + per-set
//     printings), assembles a `CandidateItem` per printing, and
//     returns the matching subset.
//
// The editor caps preview evaluation at the slice the catalog
// hook returned — this is a v1 preview, not a precise count
// against the entire database. The Save flow persists the AST
// untouched; the server re-evaluates against the full catalog
// when the smart collection is read.

import {
  evaluateExpression,
  explainExpression,
  isSmartDslParseError,
  parseExpression,
  type CandidateItem,
  type Expression,
} from '@binderly/smart-collection-dsl';

import type { CardDto, PrintingDto, SetDto } from '@binderly/api-contracts';

/**
 * Result of `parseDslText`. Discriminated by `status` so the editor
 * can pattern-match on it without inspecting individual fields.
 *
 *   - `empty` — the input was whitespace-only. The editor shows a
 *     "type your DSL here" hint and disables Run / Save.
 *   - `json-error` — the text didn't parse as JSON. Carries the
 *     underlying parse error message verbatim.
 *   - `dsl-error` — JSON is well-formed but the DSL schema rejects
 *     it. Carries both the human-readable head message AND a
 *     structured issue list so the UI can render a focused diff.
 *   - `ok` — parsed and normalized; carries the canonical
 *     `Expression` and a one-line human explanation.
 */
export type ParseDslResult =
  | { readonly status: 'empty' }
  | { readonly status: 'json-error'; readonly message: string }
  | {
      readonly status: 'dsl-error';
      readonly message: string;
      readonly issues: readonly { readonly path: readonly (string | number)[]; readonly message: string }[];
    }
  | {
      readonly status: 'ok';
      readonly expression: Expression;
      readonly explanation: string;
    };

/**
 * Parse a raw DSL text payload. Trims whitespace, attempts JSON
 * decode, then runs the smart-DSL schema. Wrapper exists to
 * collapse the multi-stage failure modes into a single typed
 * result the editor can render.
 */
export function parseDslText(text: string): ParseDslResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { status: 'empty' };
  }
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Invalid JSON';
    return { status: 'json-error', message };
  }
  try {
    const expression = parseExpression(json);
    const explanation = explainExpression(expression);
    return { status: 'ok', expression, explanation };
  } catch (cause) {
    if (isSmartDslParseError(cause)) {
      return {
        status: 'dsl-error',
        message: cause.message,
        issues: cause.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
        })),
      };
    }
    const message = cause instanceof Error ? cause.message : 'Failed to parse DSL';
    return { status: 'dsl-error', message, issues: [] };
  }
}

// ============================================================
// Catalog evaluation
// ============================================================

/**
 * Per-printing context the evaluator needs. The caller pre-joins
 * card + set + printing rows; this module owns the projection into
 * the DSL's `CandidateItem` shape.
 */
export interface CatalogPrintingRow {
  readonly card: CardDto;
  readonly set: SetDto;
  readonly printing: PrintingDto;
}

export interface EvaluateMatch {
  readonly card: CardDto;
  readonly set: SetDto;
  readonly printing: PrintingDto;
  readonly owned: boolean;
}

/**
 * Evaluate `expr` against a fetched catalog slice. Returns the
 * matching rows in the same order they were supplied — preview UX
 * benefits from stable ordering as the user iterates on their
 * expression.
 *
 * `ownedPrintingIds` is consulted so DSL fields like
 * `collection.isOwned` / `collection.quantity` resolve correctly.
 * Non-owned printings still produce a matched row when the
 * expression doesn't reference any `collection.*` field — the
 * evaluator handles that via the `collection` field being
 * `undefined`.
 */
export function evaluateAgainstCatalog(
  expr: Expression,
  catalog: ReadonlyArray<CatalogPrintingRow>,
  ownedPrintingIds: ReadonlySet<string>,
): EvaluateMatch[] {
  const matches: EvaluateMatch[] = [];
  for (const row of catalog) {
    const owned = ownedPrintingIds.has(row.printing.id);
    const candidate = projectToCandidate(row, owned);
    if (evaluateExpression(expr, candidate)) {
      matches.push({ ...row, owned });
    }
  }
  return matches;
}

function projectToCandidate(row: CatalogPrintingRow, owned: boolean): CandidateItem {
  const candidate: CandidateItem = {
    card: {
      name: row.card.name,
      number: row.card.number,
      illustrator: row.card.illustrator,
      language: row.card.language,
      type: row.card.type,
      subtype: row.card.subtype,
      rarity: row.card.rarity,
      hp: row.card.hp,
      retreatCost: row.card.retreatCost,
    },
    set: {
      code: row.set.code,
      name: row.set.name,
      series: row.set.series,
      language: row.set.language,
      releaseDate: row.set.releaseDate,
      printedTotal: row.set.printedTotal,
      total: row.set.total,
    },
    printing: {
      variantClass: row.printing.variantClass,
      variantFlags: row.printing.variantFlags,
      variantCode: row.printing.variantCode,
      includeInMasterSet: row.printing.includeInMasterSet,
    },
  };
  if (owned) {
    return {
      ...candidate,
      // Preview defaults — we don't have the user's per-printing
      // condition / grade fields handy at preview time without an
      // extra fan-out, so the preview returns the printing as
      // owned with neutral metadata. Saved smart collections
      // always re-evaluate server-side against full data anyway.
      collection: {
        condition: 'NEAR_MINT',
        gradeCompany: null,
        grade: null,
        quantity: 1,
        acquiredAt: null,
      },
    };
  }
  return candidate;
}
