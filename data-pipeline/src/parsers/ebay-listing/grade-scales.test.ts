import { describe, expect, it } from 'vitest';

import { conditionToTier, gradeToTier, validateGrade, HALF_STEP_GRADES } from './grade-scales.js';

describe('validateGrade', () => {
  it('accepts integer grades 1..10', () => {
    for (let g = 1; g <= 10; g++) {
      expect(() => validateGrade('PSA', g)).not.toThrow();
    }
  });

  it('accepts half-step grades', () => {
    expect(() => validateGrade('BGS', 9.5)).not.toThrow();
    expect(() => validateGrade('CGC', 8.5)).not.toThrow();
  });

  it('rejects out-of-range grades', () => {
    expect(() => validateGrade('PSA', 0)).toThrow();
    expect(() => validateGrade('PSA', 11)).toThrow();
    expect(() => validateGrade('PSA', -1)).toThrow();
  });

  it('rejects sub-half-step precision', () => {
    expect(() => validateGrade('PSA', 8.25)).toThrow();
    expect(() => validateGrade('PSA', 9.7)).toThrow();
  });

  it('rejects non-finite grades', () => {
    expect(() => validateGrade('PSA', Number.NaN)).toThrow();
    expect(() => validateGrade('PSA', Number.POSITIVE_INFINITY)).toThrow();
  });

  it('exports HALF_STEP_GRADES covering [10, 1] descending', () => {
    expect(HALF_STEP_GRADES[0]).toBe(10);
    expect(HALF_STEP_GRADES[HALF_STEP_GRADES.length - 1]).toBe(1);
    expect(HALF_STEP_GRADES.length).toBe(19);
  });
});

describe('gradeToTier — PSA', () => {
  it.each([
    [10, null, 'PSA_10'],
    [9, null, 'PSA_9'],
    [9.5, null, 'PSA_9'],
    [8, null, 'PSA_8'],
    [8.5, null, 'PSA_8'],
    [7, null, 'PSA_7'],
    [7.5, null, 'PSA_7'],
    [6.5, null, 'PSA_LOWER'],
    [6, null, 'PSA_LOWER'],
    [3, null, 'PSA_LOWER'],
    [1, null, 'PSA_LOWER'],
  ])('PSA %s (%s) → %s', (grade, label, expected) => {
    expect(gradeToTier('PSA', grade, label)).toBe(expected);
  });
});

describe('gradeToTier — BGS', () => {
  it.each([
    [10, 'Black Label', 'BGS_10_BLACK'],
    [10, 'BLACK', 'BGS_10_BLACK'],
    [10, null, 'BGS_10'],
    [9.5, null, 'BGS_9_5'],
    [9, null, 'BGS_9'],
    [8.5, null, 'BGS_LOWER'],
    [1, null, 'BGS_LOWER'],
  ])('BGS %s (%s) → %s', (grade, label, expected) => {
    expect(gradeToTier('BGS', grade, label)).toBe(expected);
  });
});

describe('gradeToTier — CGC', () => {
  it.each([
    [10, 'PRISTINE', 'CGC_10_PRISTINE'],
    [10, 'Pristine', 'CGC_10_PRISTINE'],
    [10, null, 'CGC_10'],
    [9.5, null, 'CGC_9_5'],
    [9, null, 'CGC_9'],
    [8.5, null, 'CGC_LOWER'],
    [1, null, 'CGC_LOWER'],
  ])('CGC %s (%s) → %s', (grade, label, expected) => {
    expect(gradeToTier('CGC', grade, label)).toBe(expected);
  });
});

describe('gradeToTier — SGC and OTHER bucket', () => {
  it('SGC any grade → OTHER_GRADED', () => {
    expect(gradeToTier('SGC', 10)).toBe('OTHER_GRADED');
    expect(gradeToTier('SGC', 8)).toBe('OTHER_GRADED');
  });

  it('OTHER any grade → OTHER_GRADED', () => {
    expect(gradeToTier('OTHER', 10)).toBe('OTHER_GRADED');
    expect(gradeToTier('OTHER', 9)).toBe('OTHER_GRADED');
  });
});

describe('conditionToTier', () => {
  it.each([
    [null, 'RAW_UNKNOWN'],
    ['MINT', 'RAW_NM'],
    ['NEAR_MINT', 'RAW_NM'],
    ['LIGHTLY_PLAYED', 'RAW_LP'],
    ['MODERATELY_PLAYED', 'RAW_MP'],
    ['HEAVILY_PLAYED', 'RAW_HP'],
    ['DAMAGED', 'RAW_DMG'],
  ] as const)('%s → %s', (cond, expected) => {
    expect(conditionToTier(cond)).toBe(expected);
  });
});

describe('grade tier coverage — every canonical tier reachable', () => {
  it('every GradeTier from data-model.md is the result of at least one canonical input', () => {
    const reached = new Set<string>([
      gradeToTier('PSA', 10),
      gradeToTier('PSA', 9),
      gradeToTier('PSA', 8),
      gradeToTier('PSA', 7),
      gradeToTier('PSA', 5),
      gradeToTier('BGS', 10, 'Black Label'),
      gradeToTier('BGS', 10),
      gradeToTier('BGS', 9.5),
      gradeToTier('BGS', 9),
      gradeToTier('BGS', 8),
      gradeToTier('CGC', 10, 'PRISTINE'),
      gradeToTier('CGC', 10),
      gradeToTier('CGC', 9.5),
      gradeToTier('CGC', 9),
      gradeToTier('CGC', 8),
      gradeToTier('SGC', 10),
      conditionToTier('NEAR_MINT'),
      conditionToTier('LIGHTLY_PLAYED'),
      conditionToTier('MODERATELY_PLAYED'),
      conditionToTier('HEAVILY_PLAYED'),
      conditionToTier('DAMAGED'),
      conditionToTier(null),
    ]);
    const expected = [
      'PSA_10',
      'PSA_9',
      'PSA_8',
      'PSA_7',
      'PSA_LOWER',
      'BGS_10_BLACK',
      'BGS_10',
      'BGS_9_5',
      'BGS_9',
      'BGS_LOWER',
      'CGC_10_PRISTINE',
      'CGC_10',
      'CGC_9_5',
      'CGC_9',
      'CGC_LOWER',
      'OTHER_GRADED',
      'RAW_NM',
      'RAW_LP',
      'RAW_MP',
      'RAW_HP',
      'RAW_DMG',
      'RAW_UNKNOWN',
    ];
    for (const t of expected) {
      expect(reached.has(t), `tier ${t} reachable`).toBe(true);
    }
  });
});
