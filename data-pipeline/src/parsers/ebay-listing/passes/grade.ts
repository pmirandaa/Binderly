// Grade pass — slab + grading-company + numeric-grade extraction.
//
// Highest-precision pass; runs first (after preclean) because the
// output drives the lot pass's confidence accounting and the
// condition pass's gating ("only run condition for raw cards").
//
// The pass tries each company-specific regex against the working
// string in order:
//
//   1. `psa\s*(?<g>10|9\.5|9|...)\b`
//   2. `bgs\s*(?:black\s*label\s*)?(?<g>...)` (with label capture)
//   3. `cgc\s*(?:pristine\s*)?(?<g>...)` (with label capture)
//   4. `sgc\s*(?<g>...)`
//   5. `(?:ace|ags)\s*(?<g>...)` → `OTHER`
//   6. `gem\s*(?:mt|mint)\s*(?<g>10)\b` (un-companied "GEM MINT 10",
//      ambiguous between PSA and the generic gem-mint vocabulary —
//      treat as `OTHER` so we still flag isSlab without inventing a
//      company)
//   7. Bare `\bgraded\b` → `isSlab=true` only (no company, no grade)
//
// The numeric-grade regex is intentionally restricted to half-step
// values in [1, 10] — far simpler than parsing arbitrary decimals and
// avoids matching listing dates ("1999"), prices, or year suffixes.
//
// On a match the pass *redacts* the consumed span from the working
// string (replaces with spaces) so subsequent passes don't re-claim
// it. A redacted "psa 10" becomes "       " of identical length so
// regex offsets in callers stay stable.

import { gradeToTier, validateGrade } from '../grade-scales.js';

import type { GradeCompany, GradeTier } from '../types.js';

export interface GradeMatch {
  readonly company: GradeCompany | null;
  readonly grade: number | null;
  readonly gradeLabel: string | null;
  readonly isSlab: boolean;
  readonly gradeTier: GradeTier | null;
  /** New working string with the matched span(s) redacted to spaces. */
  readonly remaining: string;
  /** Diagnostic labels for every signal claimed. */
  readonly signals: readonly string[];
}

// Half-step grade pattern: 1 | 1.5 | 2 | ... | 9.5 | 10. Note the
// alternation order — longer literals first (`10` before `1`,
// `9.5` before `9`) so the engine commits to the most specific form
// first.
const GRADE_NUMBER = String.raw`(?:10(?:\.0)?|9\.5|9|8\.5|8|7\.5|7|6\.5|6|5\.5|5|4\.5|4|3\.5|3|2\.5|2|1\.5|1)`;

// Optional "GEM MINT" / "GEM-MT" / "MINT" / "PRISTINE" label noise
// often seen between the company and the grade.
const OPTIONAL_LABEL = String.raw`(?:\s+(?:gem\s*-?\s*mt|gem\s*mint|mint|pristine|black\s*label))*`;

// Company-specific regexes. Each captures `g` (the grade) and
// optionally `label` (BGS Black Label / CGC Pristine).
const PSA_RE = new RegExp(
  String.raw`\bpsa\b${OPTIONAL_LABEL}\s*(?<g>${GRADE_NUMBER})\b(?<after>${OPTIONAL_LABEL})`,
);
const BGS_RE = new RegExp(
  String.raw`\bbgs\b\s*(?<labelBefore>black\s*label\s*)?(?<g>${GRADE_NUMBER})\b\s*(?<labelAfter>black\s*label|pristine)?`,
);
const CGC_RE = new RegExp(
  String.raw`\bcgc\b\s*(?<labelBefore>pristine\s*)?(?<g>${GRADE_NUMBER})\b\s*(?<labelAfter>pristine|perfect)?`,
);
const SGC_RE = new RegExp(String.raw`\bsgc\b\s*(?<g>${GRADE_NUMBER})\b`);
// Restricted grade range: only typical slab outcomes (8 / 8.5 / 9 /
// 9.5 / 10). Names like "ACE Spec" or "Charizard ACE 5" don't fire
// against this regex because the trailing number must be a typical
// slab grade.
const OTHER_GRADER_RE = new RegExp(
  String.raw`\b(?<grader>ace|ags|hga|gma)\b\s*(?<g>10|9\.5|9|8\.5|8)\b`,
);
const GENERIC_GEM_MINT_RE = new RegExp(String.raw`\bgem\s*-?\s*(?:mt|mint)\s*(?<g>10|9)\b`);
const BARE_GRADED_RE = /\bgraded\b/;

/**
 * Replace the matched character range in `s` with spaces of the same
 * length. Leaves length stable for callers that pin offsets.
 */
function redact(s: string, start: number, end: number): string {
  return s.slice(0, start) + ' '.repeat(end - start) + s.slice(end);
}

interface CompanyMatch {
  readonly company: GradeCompany;
  readonly grade: number;
  readonly gradeLabel: string | null;
  readonly start: number;
  readonly end: number;
}

function tryCompanyRegex(
  s: string,
  re: RegExp,
  company: GradeCompany,
  extractLabel: (m: RegExpExecArray) => string | null,
): CompanyMatch | null {
  const m = re.exec(s);
  if (!m || m.index === undefined) return null;
  const grade = Number.parseFloat(m.groups?.g ?? '');
  if (!Number.isFinite(grade)) return null;
  try {
    validateGrade(company, grade);
  } catch {
    return null;
  }
  return {
    company,
    grade,
    gradeLabel: extractLabel(m),
    start: m.index,
    end: m.index + m[0].length,
  };
}

/**
 * Run the grade pass on a working string. On match, returns the
 * extracted slab metadata + the redacted working string. On no
 * match, returns a no-op result with `remaining === working`.
 */
export function detectGrade(working: string): GradeMatch {
  // PSA — try first; PSA dominates the corpus.
  const psa = tryCompanyRegex(working, PSA_RE, 'PSA', (m) => {
    const after = m.groups?.after ?? '';
    return after.trim() === '' ? null : after.trim().toUpperCase();
  });
  if (psa) {
    return {
      company: 'PSA',
      grade: psa.grade,
      gradeLabel: psa.gradeLabel,
      isSlab: true,
      gradeTier: gradeToTier('PSA', psa.grade, psa.gradeLabel),
      remaining: redact(working, psa.start, psa.end),
      signals: ['grade:psa', `grade:value=${psa.grade}`, 'slab'],
    };
  }
  // BGS
  const bgs = tryCompanyRegex(working, BGS_RE, 'BGS', (m) => {
    const before = m.groups?.labelBefore?.trim();
    const after = m.groups?.labelAfter?.trim();
    return before ?? after ?? null;
  });
  if (bgs) {
    return {
      company: 'BGS',
      grade: bgs.grade,
      gradeLabel: bgs.gradeLabel,
      isSlab: true,
      gradeTier: gradeToTier('BGS', bgs.grade, bgs.gradeLabel),
      remaining: redact(working, bgs.start, bgs.end),
      signals: ['grade:bgs', `grade:value=${bgs.grade}`, 'slab'],
    };
  }
  // CGC
  const cgc = tryCompanyRegex(working, CGC_RE, 'CGC', (m) => {
    const before = m.groups?.labelBefore?.trim();
    const after = m.groups?.labelAfter?.trim();
    return before ?? after ?? null;
  });
  if (cgc) {
    return {
      company: 'CGC',
      grade: cgc.grade,
      gradeLabel: cgc.gradeLabel,
      isSlab: true,
      gradeTier: gradeToTier('CGC', cgc.grade, cgc.gradeLabel),
      remaining: redact(working, cgc.start, cgc.end),
      signals: ['grade:cgc', `grade:value=${cgc.grade}`, 'slab'],
    };
  }
  // SGC → bucket as OTHER_GRADED
  const sgc = tryCompanyRegex(working, SGC_RE, 'SGC', () => null);
  if (sgc) {
    return {
      company: 'SGC',
      grade: sgc.grade,
      gradeLabel: null,
      isSlab: true,
      gradeTier: gradeToTier('SGC', sgc.grade, null),
      remaining: redact(working, sgc.start, sgc.end),
      signals: ['grade:sgc', `grade:value=${sgc.grade}`, 'slab'],
    };
  }
  // Other graders — bucket as OTHER
  const other = tryCompanyRegex(working, OTHER_GRADER_RE, 'OTHER', (m) => {
    const grader = m.groups?.grader ?? '';
    return grader.toUpperCase();
  });
  if (other) {
    return {
      company: 'OTHER',
      grade: other.grade,
      gradeLabel: other.gradeLabel,
      isSlab: true,
      gradeTier: 'OTHER_GRADED',
      remaining: redact(working, other.start, other.end),
      signals: ['grade:other', `grade:value=${other.grade}`, 'slab'],
    };
  }
  // Generic "GEM MINT 10" — flag the slab without a company.
  const gem = GENERIC_GEM_MINT_RE.exec(working);
  if (gem && gem.index !== undefined) {
    const grade = Number.parseFloat(gem.groups?.g ?? '10');
    if (Number.isFinite(grade)) {
      return {
        company: null,
        grade,
        gradeLabel: 'GEM MINT',
        isSlab: true,
        gradeTier: 'OTHER_GRADED',
        remaining: redact(working, gem.index, gem.index + gem[0].length),
        signals: ['grade:gem-mint', `grade:value=${grade}`, 'slab'],
      };
    }
  }
  // "graded" without a digit — minimal slab signal.
  const graded = BARE_GRADED_RE.exec(working);
  if (graded && graded.index !== undefined) {
    return {
      company: null,
      grade: null,
      gradeLabel: null,
      isSlab: true,
      gradeTier: null,
      remaining: redact(working, graded.index, graded.index + graded[0].length),
      signals: ['grade:bare-slab', 'slab'],
    };
  }
  return {
    company: null,
    grade: null,
    gradeLabel: null,
    isSlab: false,
    gradeTier: null,
    remaining: working,
    signals: [],
  };
}
