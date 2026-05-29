// Pure client-side validation for the community submission form.
//
// Mirrors the server-side rules in
// `apps/api-python/grading/flywheel/validation.py` so a submission that passes
// here also passes on the server (which re-validates — the client is never
// trusted). Keeping this pure (no React, no I/O) means the screen renders the
// error state from a value and the test-suite pins every rule without mounting.

import type {
  SubmitCommunitySubmissionRequest,
  CommunitySubgrades,
} from '@binderly/api-contracts';

import {
  SUBGRADE_KEYS,
  type CommunityGradeCompany,
  type CommunitySubmissionForm,
  type CommunitySubmissionImages,
  type SubgradeKey,
} from './types.js';

// Per-company cert-number shape, applied to the normalised digits-only cert.
// Heuristic ranges (not checksums) — they reject obvious typos, matching the
// Python `_CERT_PATTERNS`.
const CERT_PATTERNS: Record<CommunityGradeCompany, RegExp> = {
  PSA: /^\d{7,9}$/,
  BGS: /^\d{8,11}$/,
  CGC: /^\d{7,12}$/,
  SGC: /^\d{6,11}$/,
};

const COMPANY_TOKENS = ['PSA', 'BGS', 'BVG', 'CGC', 'SGC', 'BECKETT', 'CERT', '#'];

/**
 * Canonicalise a raw cert number: uppercase, strip a leading label token,
 * remove spaces / hyphens / `#`. Mirrors `normalize_cert_number` in Python.
 */
export function normalizeCertNumber(company: string, raw: string): string {
  let text = (raw ?? '').trim().toUpperCase();
  if (text.length === 0) return '';
  let changed = true;
  while (changed) {
    changed = false;
    for (const token of COMPANY_TOKENS) {
      if (text.startsWith(token)) {
        text = text.slice(token.length).replace(/^[\s:#-]+/, '');
        changed = true;
      }
    }
  }
  const companyUpper = (company ?? '').trim().toUpperCase();
  if (companyUpper.length > 0 && text.startsWith(companyUpper)) {
    text = text.slice(companyUpper.length).replace(/^[\s:#-]+/, '');
  }
  return text.replace(/[\s\-#]/g, '');
}

/** Parse a grade text field. Returns `null` for blank, `NaN` for non-numeric. */
function parseGrade(raw: string): number | null {
  const trimmed = (raw ?? '').trim();
  if (trimmed.length === 0) return null;
  return Number(trimmed);
}

/** A grade is valid iff it sits on the 0.5 grid within [1, 10]. */
export function isGradeOnGrid(value: number): boolean {
  if (!Number.isFinite(value)) return false;
  if (value < 1 || value > 10) return false;
  return Number.isInteger(value * 2);
}

export interface ValidationOutcome {
  readonly ok: boolean;
  /** Field-keyed error messages (e.g. `{ certNumber: '...' }`). */
  readonly errors: Readonly<Record<string, string>>;
  /** The wire-ready request — present only when `ok === true`. */
  readonly request?: SubmitCommunitySubmissionRequest;
}

/**
 * Validate the form + the backing photos and, on success, produce the
 * `SubmitCommunitySubmissionRequest` ready to POST.
 */
export function validateCommunityForm(
  form: CommunitySubmissionForm,
  images: CommunitySubmissionImages,
): ValidationOutcome {
  const errors: Record<string, string> = {};

  // ── cert number ──────────────────────────────────────────────────────────
  const normalized = normalizeCertNumber(form.gradeCompany, form.certNumber);
  if (normalized.length === 0) {
    errors.certNumber = 'Enter the cert number from the slab.';
  } else if (!CERT_PATTERNS[form.gradeCompany].test(normalized)) {
    errors.certNumber = `That doesn't look like a valid ${form.gradeCompany} cert number.`;
  }

  // ── overall grade ─────────────────────────────────────────────────────────
  const overall = parseGrade(form.overallGrade);
  if (overall !== null && !isGradeOnGrid(overall)) {
    errors.overallGrade = 'Grade must be between 1 and 10 in 0.5 steps.';
  }

  // ── sub-grades (optional) ──────────────────────────────────────────────────
  const subgrades: Record<string, number> = {};
  for (const key of SUBGRADE_KEYS) {
    const parsed = parseGrade(form.subgrades[key]);
    if (parsed === null) continue;
    if (!isGradeOnGrid(parsed)) {
      errors[`subgrade_${key}`] = `${capitalize(key)} sub-grade must be 1–10 in 0.5 steps.`;
    } else {
      subgrades[key] = parsed;
    }
  }

  // ── grade signal present? ───────────────────────────────────────────────────
  const hasSignal = form.blackLabel || overall !== null || Object.keys(subgrades).length > 0;
  if (!hasSignal) {
    errors.overallGrade = 'Enter the overall grade (or sub-grades / Black Label).';
  }

  // ── photos ────────────────────────────────────────────────────────────────
  if (!images.front) {
    errors.images = 'A front photo is required — capture the card first.';
  } else if (!images.back) {
    errors.images = 'A back photo is required — capture the card first.';
  }

  // ── consent ─────────────────────────────────────────────────────────────────
  if (!form.consent) {
    errors.consent = 'Please consent to your photos + grade being used as training data.';
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  const request: SubmitCommunitySubmissionRequest = {
    gradeCompany: form.gradeCompany,
    certNumber: form.certNumber.trim(),
    blackLabel: form.blackLabel,
    consent: true,
    images: buildImages(images),
    ...(overall !== null ? { overallGrade: overall } : {}),
    ...(Object.keys(subgrades).length > 0
      ? { subgrades: subgrades as CommunitySubgrades }
      : {}),
  };

  return { ok: true, errors: {}, request };
}

function buildImages(
  images: CommunitySubmissionImages,
): SubmitCommunitySubmissionRequest['images'] {
  // front + back are guaranteed present by the time we reach here.
  const out: {
    front: string;
    back: string;
    corners?: string[];
    surface?: string;
    slab?: string;
  } = {
    front: images.front as string,
    back: images.back as string,
  };
  if (images.corners && images.corners.length > 0) {
    out.corners = [...images.corners];
  }
  if (images.surface) out.surface = images.surface;
  if (images.slab) out.slab = images.slab;
  return out;
}

function capitalize(value: SubgradeKey): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
