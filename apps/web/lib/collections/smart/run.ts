// Pure DSL runner used by both the editor preview and the saved
// smart-collection viewer. Wraps the package's
// `safeParseExpression` + `evaluateExpression` + `explain-
// Expression` calls into a single typed result the view layer
// can branch on.
//
// Two stages:
//   1. `parseSmartExpressionInput()` — text → typed Expression
//      result (handles JSON.parse errors AND DSL parse errors).
//   2. `runExpression()` — Expression + catalog preview + owned
//      items → SmartRunResult (matched printings, total scanned,
//      explain string).
//
// The view layer can run stage 1 on every keystroke (cheap; no
// I/O) and stage 2 only when the user clicks "Run" (linear in
// the preview size).

import type {
  CardWithPrintingsDto,
  CollectionItemDto,
  PrintingDto,
  SetDto,
  SmartPreviewItemDto,
  SmartPreviewResponseDto,
} from '@binderly/api-contracts';
import {
  evaluateExpression,
  explainExpression,
  isSmartDslParseError,
  safeParseExpression,
  type Expression,
  type SmartDslParseError,
} from '@binderly/smart-collection-dsl';

import {
  indexOwnedItems,
  projectCandidateItem,
  type CatalogPreview,
} from './api';
import { variantClassLabel } from './format';


/**
 * Discriminated union from the editor's textarea content. The
 * UI hands the textarea string in directly; this helper parses
 * JSON, then runs the DSL schema, returning a single typed
 * result the view branches on.
 */
export type ParseResult =
  | { kind: 'empty' }
  | { kind: 'parsed'; expression: Expression; explanation: string }
  | { kind: 'json-error'; message: string }
  | { kind: 'dsl-error'; message: string; error: SmartDslParseError };

/**
 * Try to parse the user's textarea content into an Expression.
 * Whitespace-only input is treated as `'empty'` (no error).
 */
export function parseSmartExpressionInput(text: string): ParseResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { kind: 'empty' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    const message =
      err instanceof Error && err.message.length > 0 ? err.message : 'Invalid JSON';
    return { kind: 'json-error', message };
  }
  const result = safeParseExpression(parsed);
  if (!result.success) {
    return { kind: 'dsl-error', message: result.error.message, error: result.error };
  }
  return {
    kind: 'parsed',
    expression: result.data,
    explanation: explainExpression(result.data),
  };
}

/**
 * Type guard re-export — useful when callers `catch` a thrown
 * error and want to branch on whether it was a DSL parse
 * failure.
 */
export { isSmartDslParseError };

// ============================================================
// Run
// ============================================================

/**
 * One matched printing's display tuple. Pre-resolved so the
 * grid view doesn't have to look up the parent card / set per
 * row.
 */
export interface SmartRunMatch {
  readonly printing: PrintingDto;
  readonly card: CardWithPrintingsDto;
  readonly set: SetDto;
}

/**
 * `runExpression()`'s output. `scanned` is the total number of
 * candidate items the evaluator ran against (== preview size).
 * `matches` is the subset that satisfied the expression, in the
 * preview's iteration order (which is set release order from
 * the catalog walk).
 */
export interface SmartRunResult {
  readonly matches: SmartRunMatch[];
  readonly scanned: number;
  readonly capped: boolean;
  readonly previewLimit: number;
  readonly explanation: string;
  readonly evaluatedAt: string;
}

export interface RunExpressionOptions {
  readonly previewLimit?: number;
  /**
   * Optional override for "now" — tests pin a stable timestamp.
   * Defaults to `new Date().toISOString()`.
   */
  readonly now?: () => string;
}

/**
 * Evaluate `expression` against the catalog preview. Pure: no
 * I/O, no React, no Date side-effects beyond the optional `now`
 * injection.
 */
export function runExpression(
  expression: Expression,
  preview: CatalogPreview,
  ownedItems: ReadonlyArray<CollectionItemDto>,
  options: RunExpressionOptions = {},
): SmartRunResult {
  const previewLimit = options.previewLimit ?? preview.printings.length;
  const now = options.now ?? ((): string => new Date().toISOString());
  const owned = indexOwnedItems(ownedItems);
  const matches: SmartRunMatch[] = [];
  for (const printing of preview.printings) {
    const card = preview.cardsById.get(printing.cardId);
    if (card === undefined) continue;
    const set = preview.setsById.get(card.setId);
    if (set === undefined) continue;
    const candidate = projectCandidateItem(printing, preview.cardsById, preview.setsById, owned);
    if (candidate === null) continue;
    if (evaluateExpression(expression, candidate)) {
      matches.push({ printing, card, set });
    }
  }
  return {
    matches,
    scanned: preview.printings.length,
    capped: preview.printings.length >= previewLimit,
    previewLimit,
    explanation: explainExpression(expression),
    evaluatedAt: now(),
  };
}

// ============================================================
// Display view shape — bridges client-eval matches and server-
// preview rows so <MatchGrid> can render both without forking.
// ============================================================

/**
 * Narrow display tuple <MatchGrid> reads off each match row.
 * Both the local `SmartRunMatch` (from `runExpression()`) and the
 * server's `SmartPreviewItemDto` project into this shape — the
 * grid stays a single component shared by both code paths.
 */
export interface SmartMatchView {
  readonly printingId: string;
  readonly cardId: string;
  readonly setId: string;
  readonly cardName: string;
  readonly cardNumber: string;
  readonly setName: string;
  readonly variantLabel: string;
  readonly imageSmallUrl: string | null;
}

/**
 * Project a local `SmartRunMatch` (from `runExpression()`) into
 * the shared display shape. `variantClass` is mapped to a human
 * label via `variantClassLabel()`.
 */
export function runMatchToView(match: SmartRunMatch): SmartMatchView {
  return {
    printingId: match.printing.id,
    cardId: match.card.id,
    setId: match.set.id,
    cardName: match.card.name,
    cardNumber: match.card.number,
    setName: match.set.name,
    variantLabel: variantClassLabel(match.printing.variantClass),
    imageSmallUrl: match.printing.imageSmallUrl,
  };
}

/**
 * Project a server `SmartPreviewItemDto` into the shared display
 * shape. The server already formats `variantLabel`, so no
 * conversion is needed.
 */
export function previewItemToView(item: SmartPreviewItemDto): SmartMatchView {
  return {
    printingId: item.printingId,
    cardId: item.cardId,
    setId: item.setId,
    cardName: item.cardName,
    cardNumber: item.cardNumber,
    setName: item.setName,
    variantLabel: item.variantLabel,
    imageSmallUrl: item.imageSmallUrl,
  };
}

/**
 * Convenience: project an entire server preview response into
 * display rows. Pure projection — `totalCount` / `nextOffset` are
 * carried alongside for the result-summary copy.
 */
export interface SmartServerPreviewView {
  readonly matches: SmartMatchView[];
  readonly totalCount: number;
  readonly nextOffset: number | null;
}

export function mapSmartPreviewResponse(
  response: SmartPreviewResponseDto,
): SmartServerPreviewView {
  return {
    matches: response.items.map(previewItemToView),
    totalCount: response.totalCount,
    nextOffset: response.nextOffset,
  };
}
