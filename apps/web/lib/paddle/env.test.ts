import { describe, expect, it } from 'vitest';

import {
  loadPublicPaddleEnv,
  loadServerPaddleEnv,
  REQUIRED_PUBLIC_PADDLE_ENV_KEYS,
  REQUIRED_SERVER_PADDLE_ENV_KEYS,
  DEFAULT_REVENUECAT_API_BASE_URL,
} from './env';

describe('loadPublicPaddleEnv', () => {
  it('returns unconfigured + lists missing keys when no env is set', () => {
    const result = loadPublicPaddleEnv({});
    expect(result.kind).toBe('unconfigured');
    if (result.kind !== 'unconfigured') return;
    for (const key of REQUIRED_PUBLIC_PADDLE_ENV_KEYS) {
      expect(result.missing).toContain(key);
    }
  });

  it('returns configured with sandbox default and null prices when only the token is set', () => {
    const result = loadPublicPaddleEnv({
      NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: 'live_test_token',
    });
    expect(result.kind).toBe('configured');
    if (result.kind !== 'configured') return;
    expect(result.clientToken).toBe('live_test_token');
    expect(result.environment).toBe('sandbox');
    expect(result.priceMonthly).toBeNull();
    expect(result.priceAnnual).toBeNull();
  });

  it('parses NEXT_PUBLIC_PADDLE_ENVIRONMENT=production', () => {
    const result = loadPublicPaddleEnv({
      NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: 'tok',
      NEXT_PUBLIC_PADDLE_ENVIRONMENT: 'production',
    });
    expect(result.kind).toBe('configured');
    if (result.kind !== 'configured') return;
    expect(result.environment).toBe('production');
  });

  it('falls back to sandbox for unknown NEXT_PUBLIC_PADDLE_ENVIRONMENT values', () => {
    const result = loadPublicPaddleEnv({
      NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: 'tok',
      NEXT_PUBLIC_PADDLE_ENVIRONMENT: 'staging',
    });
    expect(result.kind).toBe('configured');
    if (result.kind !== 'configured') return;
    expect(result.environment).toBe('sandbox');
  });

  it('reads NEXT_PUBLIC_PADDLE_PRICE_MONTHLY / ANNUAL when set', () => {
    const result = loadPublicPaddleEnv({
      NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: 'tok',
      NEXT_PUBLIC_PADDLE_PRICE_MONTHLY: 'pri_monthly',
      NEXT_PUBLIC_PADDLE_PRICE_ANNUAL: 'pri_annual',
    });
    expect(result.kind).toBe('configured');
    if (result.kind !== 'configured') return;
    expect(result.priceMonthly).toBe('pri_monthly');
    expect(result.priceAnnual).toBe('pri_annual');
  });

  it('treats empty strings as missing for the client token', () => {
    const result = loadPublicPaddleEnv({ NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: '' });
    expect(result.kind).toBe('unconfigured');
  });
});

describe('loadServerPaddleEnv', () => {
  it('returns unconfigured + lists missing keys when no server env is set', () => {
    const result = loadServerPaddleEnv({});
    expect(result.kind).toBe('unconfigured');
    if (result.kind !== 'unconfigured') return;
    for (const key of REQUIRED_SERVER_PADDLE_ENV_KEYS) {
      expect(result.missing).toContain(key);
    }
  });

  it('returns configured with default RC base url + null RC key when minimal env is set', () => {
    const result = loadServerPaddleEnv({
      PADDLE_API_KEY: 'srv_key',
      PADDLE_WEBHOOK_SECRET: 'pdl_whsec',
    });
    expect(result.kind).toBe('configured');
    if (result.kind !== 'configured') return;
    expect(result.apiKey).toBe('srv_key');
    expect(result.webhookSecret).toBe('pdl_whsec');
    expect(result.revenueCatApiKey).toBeNull();
    expect(result.revenueCatBaseUrl).toBe(DEFAULT_REVENUECAT_API_BASE_URL);
  });

  it('reads RC override base url and strips trailing slash', () => {
    const result = loadServerPaddleEnv({
      PADDLE_API_KEY: 'srv_key',
      PADDLE_WEBHOOK_SECRET: 'pdl_whsec',
      REVENUECAT_API_KEY: 'sk_rc',
      REVENUECAT_API_BASE_URL: 'https://stub.example.com/',
    });
    expect(result.kind).toBe('configured');
    if (result.kind !== 'configured') return;
    expect(result.revenueCatApiKey).toBe('sk_rc');
    expect(result.revenueCatBaseUrl).toBe('https://stub.example.com');
  });

  it('reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY when set, prefers SUPABASE_URL over NEXT_PUBLIC', () => {
    const result = loadServerPaddleEnv({
      PADDLE_API_KEY: 'srv_key',
      PADDLE_WEBHOOK_SECRET: 'pdl_whsec',
      SUPABASE_URL: 'https://srv.example.com',
      NEXT_PUBLIC_SUPABASE_URL: 'https://pub.example.com',
      SUPABASE_SERVICE_ROLE_KEY: 'srv_sb',
    });
    expect(result.kind).toBe('configured');
    if (result.kind !== 'configured') return;
    expect(result.supabaseUrl).toBe('https://srv.example.com');
    expect(result.supabaseServiceRoleKey).toBe('srv_sb');
  });

  it('falls back to NEXT_PUBLIC_SUPABASE_URL when SUPABASE_URL is missing', () => {
    const result = loadServerPaddleEnv({
      PADDLE_API_KEY: 'srv_key',
      PADDLE_WEBHOOK_SECRET: 'pdl_whsec',
      NEXT_PUBLIC_SUPABASE_URL: 'https://pub.example.com',
    });
    expect(result.kind).toBe('configured');
    if (result.kind !== 'configured') return;
    expect(result.supabaseUrl).toBe('https://pub.example.com');
  });
});
