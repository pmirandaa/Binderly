// Tests for `auth.ts`. Each schema gets a positive + negative
// case.

import { describe, expect, it } from 'vitest';

import {
  defaultGradeTierViewSchema,
  handleAvailabilityResponse,
  handleUnavailableReasonSchema,
  profileDto,
  profilePreferencesSchema,
  profileThemeSchema,
  sessionDto,
  shareableHandleSchema,
  subscriptionDto,
  subscriptionSourceSchema,
  subscriptionTierSchema,
  updateProfileRequest,
  userDto,
} from './auth.js';

const NOW = '2026-05-05T12:00:00Z';
const USER_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

describe('userDto', () => {
  it('parses a user with email', () => {
    expect(userDto.parse({ id: USER_ID, email: 'pablo@binderly.app', createdAt: NOW }).email).toBe(
      'pablo@binderly.app',
    );
  });

  it('parses a user without email (OAuth without email scope)', () => {
    expect(userDto.parse({ id: USER_ID, email: null, createdAt: NOW }).email).toBeNull();
  });

  it('rejects an unknown extra key (strict — no app_metadata leak)', () => {
    expect(
      userDto.safeParse({
        id: USER_ID,
        email: null,
        createdAt: NOW,
        app_metadata: { provider: 'google' },
      }).success,
    ).toBe(false);
  });
});

describe('sessionDto', () => {
  it('parses a session payload', () => {
    expect(sessionDto.parse({ userId: USER_ID, expiresAt: NOW }).userId).toBe(USER_ID);
  });

  it('rejects when expiresAt is missing', () => {
    expect(sessionDto.safeParse({ userId: USER_ID }).success).toBe(false);
  });
});

describe('profileThemeSchema', () => {
  it('accepts the three themes', () => {
    expect(profileThemeSchema.parse('system')).toBe('system');
    expect(profileThemeSchema.parse('dark')).toBe('dark');
  });

  it('rejects unknown themes', () => {
    expect(profileThemeSchema.safeParse('high-contrast').success).toBe(false);
  });
});

describe('defaultGradeTierViewSchema', () => {
  it('accepts auto and the canonical tier shortcuts', () => {
    expect(defaultGradeTierViewSchema.parse('auto')).toBe('auto');
    expect(defaultGradeTierViewSchema.parse('psa_10')).toBe('psa_10');
  });

  it('rejects unknown values', () => {
    expect(defaultGradeTierViewSchema.safeParse('best').success).toBe(false);
  });
});

describe('profilePreferencesSchema', () => {
  it('parses an empty preferences object', () => {
    expect(profilePreferencesSchema.parse({})).toEqual({});
  });

  it('parses a fully-populated preferences object', () => {
    expect(
      profilePreferencesSchema.parse({
        displayCurrency: 'EUR',
        defaultMarket: 'CARDMARKET_EU',
        cardLanguages: ['en', 'jp'],
        theme: 'dark',
        locale: 'es-CL',
        emailMarketingOptIn: false,
        defaultGradeTierView: 'psa_9',
        gradingFlywheelOptIn: true,
      }).defaultMarket,
    ).toBe('CARDMARKET_EU');
  });

  it('rejects unknown keys (strict)', () => {
    expect(profilePreferencesSchema.safeParse({ unknownPreferenceKey: true }).success).toBe(false);
  });

  it('rejects a malformed locale tag', () => {
    expect(profilePreferencesSchema.safeParse({ locale: 'INVALID LOCALE' }).success).toBe(false);
  });

  it('rejects an unknown defaultMarket', () => {
    expect(profilePreferencesSchema.safeParse({ defaultMarket: 'TCGPLAYER_DERIVED' }).success).toBe(
      false,
    );
  });
});

describe('profileDto', () => {
  const VALID = {
    userId: USER_ID,
    handle: 'pablo',
    displayName: 'Pablo',
    avatarUrl: 'https://images.binderly.app/avatars/pablo.webp',
    bio: 'TCG collector since 1999.',
    preferences: { displayCurrency: 'USD' as const },
    createdAt: NOW,
    updatedAt: NOW,
  };

  it('parses a fully-populated profile', () => {
    expect(profileDto.parse(VALID).handle).toBe('pablo');
  });

  it('parses a profile with null display fields', () => {
    expect(
      profileDto.parse({
        ...VALID,
        displayName: null,
        avatarUrl: null,
        bio: null,
      }).displayName,
    ).toBeNull();
  });

  it('rejects a too-short handle', () => {
    expect(profileDto.safeParse({ ...VALID, handle: 'pa' }).success).toBe(false);
  });

  it('rejects unknown preference keys (strict)', () => {
    expect(profileDto.safeParse({ ...VALID, preferences: { unknownKey: 1 } }).success).toBe(false);
  });
});

describe('updateProfileRequest', () => {
  it('parses a single-field PATCH', () => {
    expect(updateProfileRequest.parse({ bio: 'updated' }).bio).toBe('updated');
  });

  it('rejects an empty body', () => {
    expect(updateProfileRequest.safeParse({}).success).toBe(false);
  });

  it('rejects a handle with a hyphen (alphanumeric or underscore only)', () => {
    expect(updateProfileRequest.safeParse({ handle: 'my-handle' }).success).toBe(false);
  });
});

describe('shareableHandleSchema', () => {
  it('accepts a minimal 3-char handle', () => {
    expect(shareableHandleSchema.parse('abc')).toBe('abc');
  });

  it('accepts a handle with internal hyphens', () => {
    expect(shareableHandleSchema.parse('pablo-test')).toBe('pablo-test');
  });

  it('rejects a leading hyphen', () => {
    expect(shareableHandleSchema.safeParse('-pablo').success).toBe(false);
  });

  it('rejects uppercase letters', () => {
    expect(shareableHandleSchema.safeParse('Pablo').success).toBe(false);
  });

  it('rejects too-short (<3) handles', () => {
    expect(shareableHandleSchema.safeParse('pa').success).toBe(false);
  });

  it('rejects too-long (>30) handles', () => {
    expect(shareableHandleSchema.safeParse('a'.repeat(31)).success).toBe(false);
  });

  it('rejects whitespace', () => {
    expect(shareableHandleSchema.safeParse('pablo test').success).toBe(false);
  });

  it('rejects underscores (not in the picker pattern)', () => {
    expect(shareableHandleSchema.safeParse('pablo_test').success).toBe(false);
  });
});

describe('handleUnavailableReasonSchema', () => {
  it('accepts every documented reason', () => {
    for (const reason of ['taken', 'invalid', 'rate_limited', 'reserved'] as const) {
      expect(handleUnavailableReasonSchema.parse(reason)).toBe(reason);
    }
  });

  it('rejects unknown reasons', () => {
    expect(handleUnavailableReasonSchema.safeParse('nope').success).toBe(false);
  });
});

describe('handleAvailabilityResponse', () => {
  it('parses an available response without a reason', () => {
    expect(
      handleAvailabilityResponse.parse({ handle: 'pablo', available: true }).available,
    ).toBe(true);
  });

  it('parses an unavailable taken response with reason', () => {
    expect(
      handleAvailabilityResponse.parse({
        handle: 'pablo',
        available: false,
        reason: 'taken',
      }).reason,
    ).toBe('taken');
  });

  it('rejects unavailable without a reason', () => {
    expect(
      handleAvailabilityResponse.safeParse({ handle: 'pablo', available: false }).success,
    ).toBe(false);
  });

  it('rejects available WITH a reason (consistency invariant)', () => {
    expect(
      handleAvailabilityResponse.safeParse({
        handle: 'pablo',
        available: true,
        reason: 'taken',
      }).success,
    ).toBe(false);
  });

  it('rejects extra keys (strict mode)', () => {
    expect(
      handleAvailabilityResponse.safeParse({
        handle: 'pablo',
        available: true,
        extra: 'leak',
      }).success,
    ).toBe(false);
  });

  it('rejects a handle that fails the picker pattern', () => {
    expect(
      handleAvailabilityResponse.safeParse({
        handle: 'Pablo',
        available: true,
      }).success,
    ).toBe(false);
  });
});

describe('subscriptionTierSchema', () => {
  it('accepts free and pro', () => {
    expect(subscriptionTierSchema.parse('free')).toBe('free');
    expect(subscriptionTierSchema.parse('pro')).toBe('pro');
  });

  it('rejects unknown tiers', () => {
    expect(subscriptionTierSchema.safeParse('enterprise').success).toBe(false);
  });
});

describe('subscriptionSourceSchema', () => {
  it('accepts revenuecat and paddle', () => {
    expect(subscriptionSourceSchema.parse('revenuecat')).toBe('revenuecat');
    expect(subscriptionSourceSchema.parse('paddle')).toBe('paddle');
  });

  it('rejects unknown sources', () => {
    expect(subscriptionSourceSchema.safeParse('stripe').success).toBe(false);
  });
});

describe('subscriptionDto', () => {
  it('parses a free subscription with all nullable fields null', () => {
    expect(
      subscriptionDto.parse({
        userId: USER_ID,
        tier: 'free',
        source: null,
        externalCustomerId: null,
        expiresAt: null,
        lastEventAt: null,
      }).tier,
    ).toBe('free');
  });

  it('parses a pro subscription with full provider context', () => {
    expect(
      subscriptionDto.parse({
        userId: USER_ID,
        tier: 'pro',
        source: 'revenuecat',
        externalCustomerId: 'rc_user_abc123',
        expiresAt: '2027-05-05T12:00:00Z',
        lastEventAt: NOW,
      }).source,
    ).toBe('revenuecat');
  });

  it('rejects when raw webhook payload leaks (strict)', () => {
    expect(
      subscriptionDto.safeParse({
        userId: USER_ID,
        tier: 'pro',
        source: 'revenuecat',
        externalCustomerId: 'rc_x',
        expiresAt: NOW,
        lastEventAt: NOW,
        raw: { webhook: 'payload' },
      }).success,
    ).toBe(false);
  });
});
