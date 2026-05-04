// Main parser entry. Orchestrates the eight ordered passes
// (preclean → grade → lot → language → variants → set-number →
// name → condition), assembles the `ParsedListing` output, and
// computes the confidence score per the model documented in the
// elaborated task spec.
//
// The parser is a pure function: same input → same output, every
// run, every machine. No I/O, no clocks, no `Math.random`. The
// individual passes mirror this contract.

import { conditionToTier } from './grade-scales.js';
import { detectCondition } from './passes/condition.js';
import { detectGrade } from './passes/grade.js';
import { detectLanguage } from './passes/language.js';
import { detectLot } from './passes/lot.js';
import { detectName } from './passes/name.js';
import { preclean } from './passes/preclean.js';
import { detectSetNumber } from './passes/set-number.js';
import { detectVariants } from './passes/variants.js';
import {
  emptyGradingHints,
  emptyVariantHints,
  parsedListingSchema,
  type ParsedListing,
} from './types.js';

const MIN_TOKEN_LEN = 1;

/**
 * Parse an eBay listing title into a structured `ParsedListing`.
 * Pure function. The output is validated against
 * `parsedListingSchema` before return so consumers can rely on the
 * shape (zod throws on contract violation — i.e. a parser bug, not
 * a bad-input case).
 */
export function parseEbayListing(rawTitle: string): ParsedListing {
  const safeRaw = typeof rawTitle === 'string' ? rawTitle : '';
  const { cleaned, tokens } = preclean(safeRaw);
  const totalTokens = tokens.length;

  // Pass 2: grade. Highest precision; gates the condition pass.
  const gradeRes = detectGrade(cleaned);
  let working = gradeRes.remaining;
  const matchedSignals: string[] = [...gradeRes.signals];

  // Pass 3: lot. Runs after grade so "PSA 10 Lot of 5" still flags both.
  const lotRes = detectLot(working);
  working = lotRes.remaining;
  matchedSignals.push(...lotRes.signals);

  // Pass 4: language. Uses raw title for script detection + cleaned
  // working string for English/Japanese keyword detection.
  const langRes = detectLanguage(working, safeRaw);
  working = langRes.remaining;
  matchedSignals.push(...langRes.signals);

  // Pass 5: variants. Each match redacts; later passes don't re-claim.
  const variantsRes = detectVariants(working);
  working = variantsRes.remaining;
  matchedSignals.push(...variantsRes.signals);

  // Pass 6: set + number.
  const setNumberRes = detectSetNumber(working);
  working = setNumberRes.remaining;
  matchedSignals.push(...setNumberRes.signals);

  // Pass 7: name (residual tokens after others stripped).
  const nameRes = detectName(working);
  working = nameRes.remaining;
  matchedSignals.push(...nameRes.signals);

  // Pass 8: condition — only when not slab.
  const condRes = gradeRes.isSlab
    ? { condition: null, remaining: working, signals: [] as readonly string[] }
    : detectCondition(working);
  working = condRes.remaining;
  matchedSignals.push(...condRes.signals);

  // Final: collect leftover tokens for the `unparsedTokens` surface.
  const unparsedTokens = working
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= MIN_TOKEN_LEN && /[a-z0-9]/i.test(t));

  // Confidence model (cap at [0, 1]):
  //   slab+grade matched:                        +0.30
  //   slab only (no numeric):                    +0.15
  //   set codeHint or nameHint:                  +0.10
  //   numberHint:                                +0.20
  //   nameHint from species dictionary:          +0.20
  //   nameHint fallback:                         +0.10
  //   ≥1 variantHints.* asserted:                +0.10
  //   condition (raw cards only):                +0.10
  //   language='jp':                             +0.05
  //   isLot:                                     -0.10
  //   >50% tokens unparsed:                      -0.10
  let score = 0;
  if (gradeRes.isSlab && gradeRes.grade != null) score += 0.3;
  else if (gradeRes.isSlab) score += 0.15;
  if (setNumberRes.setCode != null || setNumberRes.setName != null) score += 0.1;
  if (setNumberRes.cardNumber != null) score += 0.2;
  if (nameRes.cardName != null) {
    score += nameRes.fromDictionary ? 0.2 : 0.1;
  }
  const variantsAsserted = Object.values(variantsRes.hints).some((v) => v != null);
  if (variantsAsserted) score += 0.1;
  if (!gradeRes.isSlab && condRes.condition != null) score += 0.1;
  if (langRes.language === 'jp') score += 0.05;
  if (lotRes.isLot) score -= 0.1;
  if (totalTokens > 0 && unparsedTokens.length / totalTokens > 0.5) score -= 0.1;

  if (score < 0) score = 0;
  if (score > 1) score = 1;
  // Clamp to 2 decimal places — the field is bounded and 0..1 with
  // arbitrary float garbage isn't useful to consumers. `Math.round`
  // is deterministic so the parser stays pure.
  score = Math.round(score * 100) / 100;

  // Promote the raw-condition tier when the grade pass didn't fire.
  const gradingHints = gradeRes.isSlab
    ? {
        company: gradeRes.company,
        grade: gradeRes.grade,
        gradeLabel: gradeRes.gradeLabel,
        isSlab: gradeRes.isSlab,
        gradeTier: gradeRes.gradeTier,
      }
    : {
        ...emptyGradingHints(),
        gradeTier: condRes.condition != null ? conditionToTier(condRes.condition) : null,
      };

  const out: ParsedListing = {
    rawTitle: safeRaw,
    cleanedTitle: cleaned,
    grading: gradingHints,
    condition: condRes.condition,
    language: langRes.language,
    set: {
      codeHint: setNumberRes.setCode,
      nameHint: setNumberRes.setName,
    },
    card: {
      numberHint: setNumberRes.cardNumber,
      nameHint: nameRes.cardName,
    },
    variantHints: variantsAsserted ? variantsRes.hints : emptyVariantHints(),
    isLot: lotRes.isLot,
    lotSize: lotRes.lotSize,
    confidenceScore: score,
    matchedSignals,
    unparsedTokens,
  };

  // Round-trip through zod so consumers get a hard guarantee on
  // shape. A failure here is a parser bug, not a bad-input case;
  // letting it throw makes the bug visible in tests.
  return parsedListingSchema.parse(out);
}
