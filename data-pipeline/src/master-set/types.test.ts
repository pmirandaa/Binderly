// Validation schema tests for `set.master_set_rules` overrides.
//
// The schema is `.strict()` — unknown keys are rejected. Every
// documented toggle is optional and boolean. The two per-printing
// arrays accept arrays of non-empty strings.

import { describe, expect, it } from 'vitest';

import {
  EMPTY_MASTER_SET_RULES,
  masterSetRulesSchema,
  parseMasterSetRules,
  safeParseMasterSetRules,
} from './types.js';

describe('masterSetRulesSchema', () => {
  it('accepts an empty object (the common case)', () => {
    const parsed = masterSetRulesSchema.parse({});
    expect(parsed).toEqual({});
  });

  it('parseMasterSetRules({}) deep-equals EMPTY_MASTER_SET_RULES', () => {
    expect(parseMasterSetRules({})).toEqual(EMPTY_MASTER_SET_RULES);
    expect(EMPTY_MASTER_SET_RULES).toEqual({});
  });

  it('parseMasterSetRules tolerates null / undefined inputs (treats them as {})', () => {
    expect(parseMasterSetRules(null)).toEqual({});
    expect(parseMasterSetRules(undefined)).toEqual({});
  });

  it('accepts every documented toggle in isolation', () => {
    const toggles = [
      'include_textured',
      'include_trainer_gallery',
      'include_pattern_variants',
      'include_prerelease',
      'include_league',
      'include_buildbattle',
      'include_championship',
      'include_staff',
      'include_error',
    ] as const;
    for (const key of toggles) {
      for (const value of [true, false]) {
        const parsed = masterSetRulesSchema.parse({ [key]: value });
        expect(parsed[key]).toBe(value);
      }
    }
  });

  it('accepts the per-printing arrays', () => {
    const parsed = masterSetRulesSchema.parse({
      additional_excluded_variant_keys: ['en-base1-058-nonholo-err'],
      additional_included_variant_keys: ['en-base1-004-holo-fe-sl'],
    });
    expect(parsed.additional_excluded_variant_keys).toEqual(['en-base1-058-nonholo-err']);
    expect(parsed.additional_included_variant_keys).toEqual(['en-base1-004-holo-fe-sl']);
  });

  it('rejects unknown keys (.strict())', () => {
    const result = safeParseMasterSetRules({ include_holos: true });
    expect(result.success).toBe(false);
  });

  it('rejects non-boolean toggles', () => {
    const result = safeParseMasterSetRules({ include_pattern_variants: 'yes' });
    expect(result.success).toBe(false);
  });

  it('rejects non-string entries in per-printing arrays', () => {
    const result = safeParseMasterSetRules({
      additional_excluded_variant_keys: [42],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty-string variant keys', () => {
    const result = safeParseMasterSetRules({
      additional_included_variant_keys: [''],
    });
    expect(result.success).toBe(false);
  });

  it('parseMasterSetRules throws ZodError on invalid input', () => {
    expect(() => parseMasterSetRules({ unknown: 1 })).toThrow();
  });
});
