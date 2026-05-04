import { describe, expect, it } from 'vitest';

import { detectGrade } from './grade.js';

describe('detectGrade — PSA', () => {
  it('matches "psa 10"', () => {
    const r = detectGrade('psa 10 charizard');
    expect(r.company).toBe('PSA');
    expect(r.grade).toBe(10);
    expect(r.gradeTier).toBe('PSA_10');
    expect(r.isSlab).toBe(true);
    expect(r.signals).toContain('grade:psa');
    expect(r.signals).toContain('slab');
  });

  it('matches "psa 9 mint"', () => {
    const r = detectGrade('psa 9 mint charizard');
    expect(r.company).toBe('PSA');
    expect(r.grade).toBe(9);
    expect(r.gradeTier).toBe('PSA_9');
  });

  it('matches "psa 10 gem mint"', () => {
    const r = detectGrade('psa 10 gem mint charizard 4/102');
    expect(r.company).toBe('PSA');
    expect(r.grade).toBe(10);
    expect(r.remaining).toContain('charizard');
    expect(r.remaining).not.toContain('psa');
  });

  it('handles half-step grades (8.5)', () => {
    const r = detectGrade('psa 8.5 charizard');
    expect(r.grade).toBe(8.5);
    expect(r.gradeTier).toBe('PSA_8');
  });

  it('buckets grades 6 and below as PSA_LOWER', () => {
    expect(detectGrade('psa 6 charizard').gradeTier).toBe('PSA_LOWER');
    expect(detectGrade('psa 5 charizard').gradeTier).toBe('PSA_LOWER');
    expect(detectGrade('psa 1 charizard').gradeTier).toBe('PSA_LOWER');
  });

  it('does not match a year token as the grade ("psa ... 1999")', () => {
    // "PSA" without an immediate slab grade (1-10) is left alone —
    // we don't want to match a year token like 1999 as the grade.
    const r = detectGrade('psa authentic charizard 1999');
    expect(r.grade).toBeNull();
    expect(r.isSlab).toBe(false);
  });
});

describe('detectGrade — BGS', () => {
  it('matches "bgs 9.5"', () => {
    const r = detectGrade('bgs 9.5 charizard');
    expect(r.company).toBe('BGS');
    expect(r.grade).toBe(9.5);
    expect(r.gradeTier).toBe('BGS_9_5');
  });

  it('matches "bgs 10 black label"', () => {
    const r = detectGrade('bgs 10 black label charizard');
    expect(r.company).toBe('BGS');
    expect(r.grade).toBe(10);
    expect(r.gradeTier).toBe('BGS_10_BLACK');
  });

  it('matches "bgs black label 10"', () => {
    const r = detectGrade('bgs black label 10 charizard');
    expect(r.company).toBe('BGS');
    expect(r.grade).toBe(10);
    expect(r.gradeTier).toBe('BGS_10_BLACK');
  });

  it('matches plain "bgs 10" as BGS_10 (no black label)', () => {
    expect(detectGrade('bgs 10 charizard').gradeTier).toBe('BGS_10');
  });

  it('buckets 8.5 and below as BGS_LOWER', () => {
    expect(detectGrade('bgs 8.5 charizard').gradeTier).toBe('BGS_LOWER');
  });
});

describe('detectGrade — CGC', () => {
  it('matches "cgc 10 pristine"', () => {
    const r = detectGrade('cgc 10 pristine charizard');
    expect(r.company).toBe('CGC');
    expect(r.grade).toBe(10);
    expect(r.gradeTier).toBe('CGC_10_PRISTINE');
  });

  it('matches "cgc pristine 10"', () => {
    const r = detectGrade('cgc pristine 10 charizard');
    expect(r.company).toBe('CGC');
    expect(r.grade).toBe(10);
    expect(r.gradeTier).toBe('CGC_10_PRISTINE');
  });

  it('matches plain "cgc 10" as CGC_10', () => {
    expect(detectGrade('cgc 10 charizard').gradeTier).toBe('CGC_10');
  });

  it('matches "cgc 9.5"', () => {
    expect(detectGrade('cgc 9.5 charizard').gradeTier).toBe('CGC_9_5');
  });
});

describe('detectGrade — SGC and other graders', () => {
  it('matches "sgc 10"', () => {
    const r = detectGrade('sgc 10 charizard');
    expect(r.company).toBe('SGC');
    expect(r.gradeTier).toBe('OTHER_GRADED');
  });

  it('matches "ags 10"', () => {
    const r = detectGrade('ags 10 charizard');
    expect(r.company).toBe('OTHER');
    expect(r.gradeTier).toBe('OTHER_GRADED');
  });

  it('matches "ace 10" (slab grade range only)', () => {
    const r = detectGrade('ace 10 charizard');
    expect(r.company).toBe('OTHER');
    expect(r.gradeTier).toBe('OTHER_GRADED');
  });

  it('does NOT match "ace 5" (out of slab range)', () => {
    const r = detectGrade('ace 5 charizard');
    expect(r.isSlab).toBe(false);
  });

  it('does NOT match "ace spec" (no number)', () => {
    const r = detectGrade('charizard ace spec');
    expect(r.isSlab).toBe(false);
  });
});

describe('detectGrade — generic gem-mint and bare-graded', () => {
  it('matches "gem mint 10" without a company → OTHER_GRADED', () => {
    const r = detectGrade('gem mint 10 charizard');
    expect(r.company).toBeNull();
    expect(r.grade).toBe(10);
    expect(r.gradeTier).toBe('OTHER_GRADED');
    expect(r.isSlab).toBe(true);
  });

  it('matches bare "graded" with no company / grade', () => {
    const r = detectGrade('graded charizard');
    expect(r.company).toBeNull();
    expect(r.grade).toBeNull();
    expect(r.isSlab).toBe(true);
  });

  it('returns no slab when nothing matches', () => {
    const r = detectGrade('charizard 4/102 base set');
    expect(r.isSlab).toBe(false);
    expect(r.remaining).toBe('charizard 4/102 base set');
  });
});

describe('detectGrade — redaction', () => {
  it('replaces matched span with whitespace, preserving length', () => {
    const input = 'psa 10 charizard';
    const r = detectGrade(input);
    expect(r.remaining.length).toBe(input.length);
    expect(r.remaining.endsWith('charizard')).toBe(true);
  });
});
