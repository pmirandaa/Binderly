import { describe, expect, it } from 'vitest';

import { emptyCommunityForm, type CommunitySubmissionImages } from '../types';
import { isGradeOnGrid, normalizeCertNumber, validateCommunityForm } from '../validation';

const IMAGES: CommunitySubmissionImages = {
  front: 'https://cdn.binderly.test/u/1/front.jpg',
  back: 'https://cdn.binderly.test/u/1/back.jpg',
  corners: ['https://cdn.binderly.test/u/1/c1.jpg'],
};

function form(overrides: Partial<ReturnType<typeof emptyCommunityForm>> = {}) {
  return { ...emptyCommunityForm(), ...overrides };
}

describe('normalizeCertNumber', () => {
  it('strips whitespace', () => {
    expect(normalizeCertNumber('PSA', '  12345678  ')).toBe('12345678');
  });

  it('strips a company prefix', () => {
    expect(normalizeCertNumber('PSA', 'PSA 12345678')).toBe('12345678');
  });

  it('removes hyphens and hashes', () => {
    expect(normalizeCertNumber('CGC', '#4380266-001')).toBe('4380266001');
  });

  it('uppercases', () => {
    expect(normalizeCertNumber('SGC', 'ac12345')).toBe('AC12345');
  });

  it('is idempotent', () => {
    const once = normalizeCertNumber('PSA', 'PSA 1234-5678');
    expect(normalizeCertNumber('PSA', once)).toBe(once);
  });
});

describe('isGradeOnGrid', () => {
  it('accepts on-grid values', () => {
    expect(isGradeOnGrid(9)).toBe(true);
    expect(isGradeOnGrid(9.5)).toBe(true);
    expect(isGradeOnGrid(1)).toBe(true);
    expect(isGradeOnGrid(10)).toBe(true);
  });

  it('rejects off-grid values', () => {
    expect(isGradeOnGrid(8.3)).toBe(false);
  });

  it('rejects out-of-range values', () => {
    expect(isGradeOnGrid(0.5)).toBe(false);
    expect(isGradeOnGrid(10.5)).toBe(false);
  });
});

describe('validateCommunityForm', () => {
  it('accepts a complete valid form and builds the request', () => {
    const out = validateCommunityForm(
      form({ certNumber: '12345678', overallGrade: '9', consent: true }),
      IMAGES,
    );
    expect(out.ok).toBe(true);
    expect(out.request).toBeDefined();
    expect(out.request?.gradeCompany).toBe('PSA');
    expect(out.request?.overallGrade).toBe(9);
    expect(out.request?.consent).toBe(true);
    expect(out.request?.images.corners).toHaveLength(1);
  });

  it('rejects a missing cert number', () => {
    const out = validateCommunityForm(form({ overallGrade: '9', consent: true }), IMAGES);
    expect(out.ok).toBe(false);
    expect(out.errors.certNumber).toBeDefined();
  });

  it('rejects a malformed cert number', () => {
    const out = validateCommunityForm(
      form({ certNumber: 'ABC', overallGrade: '9', consent: true }),
      IMAGES,
    );
    expect(out.ok).toBe(false);
    expect(out.errors.certNumber).toBeDefined();
  });

  it('rejects an off-grid overall grade', () => {
    const out = validateCommunityForm(
      form({ certNumber: '12345678', overallGrade: '8.3', consent: true }),
      IMAGES,
    );
    expect(out.ok).toBe(false);
    expect(out.errors.overallGrade).toBeDefined();
  });

  it('requires consent', () => {
    const out = validateCommunityForm(
      form({ certNumber: '12345678', overallGrade: '9', consent: false }),
      IMAGES,
    );
    expect(out.ok).toBe(false);
    expect(out.errors.consent).toBeDefined();
  });

  it('requires front + back photos', () => {
    const out = validateCommunityForm(
      form({ certNumber: '12345678', overallGrade: '9', consent: true }),
      { front: 'https://x/f.jpg' },
    );
    expect(out.ok).toBe(false);
    expect(out.errors.images).toBeDefined();
  });

  it('requires at least one grade signal', () => {
    const out = validateCommunityForm(
      form({ certNumber: '12345678', overallGrade: '', consent: true }),
      IMAGES,
    );
    expect(out.ok).toBe(false);
    expect(out.errors.overallGrade).toBeDefined();
  });

  it('accepts Black Label with no numeric grade', () => {
    const out = validateCommunityForm(
      form({
        gradeCompany: 'BGS',
        certNumber: '0015384312',
        overallGrade: '',
        blackLabel: true,
        consent: true,
      }),
      IMAGES,
    );
    expect(out.ok).toBe(true);
    expect(out.request?.blackLabel).toBe(true);
  });

  it('accepts sub-grades only', () => {
    const f = form({
      gradeCompany: 'BGS',
      certNumber: '0015384312',
      overallGrade: '',
      consent: true,
    });
    const withSub = { ...f, subgrades: { ...f.subgrades, corners: '9.5' } };
    const out = validateCommunityForm(withSub, IMAGES);
    expect(out.ok).toBe(true);
    expect(out.request?.subgrades?.corners).toBe(9.5);
  });

  it('rejects an off-grid sub-grade', () => {
    const f = form({ certNumber: '12345678', overallGrade: '9', consent: true });
    const withSub = { ...f, subgrades: { ...f.subgrades, edges: '8.3' } };
    const out = validateCommunityForm(withSub, IMAGES);
    expect(out.ok).toBe(false);
    expect(out.errors.subgrade_edges).toBeDefined();
  });

  it('omits subgrades from the request when none provided', () => {
    const out = validateCommunityForm(
      form({ certNumber: '12345678', overallGrade: '9', consent: true }),
      IMAGES,
    );
    expect(out.request?.subgrades).toBeUndefined();
  });

  it('aggregates multiple errors', () => {
    const out = validateCommunityForm(form({ certNumber: '', overallGrade: '', consent: false }), {});
    expect(out.ok).toBe(false);
    expect(Object.keys(out.errors).length).toBeGreaterThanOrEqual(3);
  });
});
