// Grade scales per company + the `gradeToTier()` mapper that
// translates a `(company, grade, label)` tuple to the canonical
// `price_observation.grade_tier` enum from `context/data-model.md`
// § "Grade tiers".
//
// The scales are deliberately permissive — collectors and listing
// titles use a mix of full-precision and abbreviated grades (PSA's
// half-grades like 9.5 are technically rare but appear in titles all
// the time, sometimes as a typo for BGS or CGC). The parser accepts
// any half-step grade in [1, 10] so the listing-pass can validate; it
// is the *tier* mapping that loses precision.

import type { GradeCompany, GradeTier } from './types.js';

/** Half-step grades in [1, 10]: 1, 1.5, 2, ..., 9.5, 10. */
export const HALF_STEP_GRADES: readonly number[] = (() => {
  const grades: number[] = [];
  for (let g = 10; g >= 1; g -= 0.5) {
    grades.push(g);
  }
  return grades;
})();

/**
 * Validates a numeric grade against the company's allowed scale.
 * Returns the grade unchanged when valid; throws when the grade is
 * outside [1, 10] or has finer than half-step precision. Used by the
 * grade pass after a regex match — out-of-range grades indicate a
 * mis-parse (e.g. "PSA 1999" matching the year as the grade) and
 * fail closed.
 */
export function validateGrade(company: GradeCompany, grade: number): number {
  if (!Number.isFinite(grade)) {
    throw new RangeError(`grade-scales: ${company} grade is not finite (${grade})`);
  }
  if (grade < 1 || grade > 10) {
    throw new RangeError(`grade-scales: ${company} grade ${grade} outside [1, 10]`);
  }
  // Half-step: 2 * grade must be a whole number.
  const doubled = grade * 2;
  if (Math.abs(doubled - Math.round(doubled)) > 1e-9) {
    throw new RangeError(`grade-scales: ${company} grade ${grade} is finer than half-step`);
  }
  return grade;
}

/**
 * `(company, grade, label?)` → canonical `GradeTier`. The label is
 * the optional companion string the grade pass extracted (`'BLACK
 * LABEL'`, `'PRISTINE'`); it elevates a 10 to the company-specific
 * top bucket (`BGS_10_BLACK`, `CGC_10_PRISTINE`).
 */
export function gradeToTier(
  company: GradeCompany,
  grade: number,
  label: string | null = null,
): GradeTier {
  validateGrade(company, grade);
  const isBlackLabel = label != null && /\bblack\b/i.test(label);
  const isPristine = label != null && /\bpristine\b/i.test(label);

  switch (company) {
    case 'PSA':
      if (grade === 10) return 'PSA_10';
      // PSA technically issues half-step grades (9.5, etc.) very
      // rarely; aggregators conventionally group them with the
      // nearest whole tier so sample sizes stay meaningful.
      if (grade === 9 || grade === 9.5) return 'PSA_9';
      if (grade === 8 || grade === 8.5) return 'PSA_8';
      if (grade === 7 || grade === 7.5) return 'PSA_7';
      return 'PSA_LOWER';
    case 'BGS':
      if (grade === 10 && isBlackLabel) return 'BGS_10_BLACK';
      if (grade === 10) return 'BGS_10';
      if (grade === 9.5) return 'BGS_9_5';
      if (grade === 9) return 'BGS_9';
      return 'BGS_LOWER';
    case 'CGC':
      if (grade === 10 && isPristine) return 'CGC_10_PRISTINE';
      if (grade === 10) return 'CGC_10';
      if (grade === 9.5) return 'CGC_9_5';
      if (grade === 9) return 'CGC_9';
      return 'CGC_LOWER';
    case 'SGC':
    case 'OTHER':
    default:
      return 'OTHER_GRADED';
  }
}

/**
 * `(rawCondition)` → canonical raw `GradeTier`. Mirrors the
 * `RAW_*` strand of the grade-tier enum.
 */
export function conditionToTier(
  condition:
    | 'MINT'
    | 'NEAR_MINT'
    | 'LIGHTLY_PLAYED'
    | 'MODERATELY_PLAYED'
    | 'HEAVILY_PLAYED'
    | 'DAMAGED'
    | null,
): GradeTier {
  if (condition === null) return 'RAW_UNKNOWN';
  switch (condition) {
    case 'MINT':
    case 'NEAR_MINT':
      return 'RAW_NM';
    case 'LIGHTLY_PLAYED':
      return 'RAW_LP';
    case 'MODERATELY_PLAYED':
      return 'RAW_MP';
    case 'HEAVILY_PLAYED':
      return 'RAW_HP';
    case 'DAMAGED':
      return 'RAW_DMG';
  }
}
