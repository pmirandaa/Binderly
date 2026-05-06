import * as SecureStore from 'expo-secure-store';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SECURE_STORAGE_KEYS,
  createInMemorySecureStorage,
  getSecureStorage,
  supabaseSecureStoreAdapter,
} from './secure-storage';

describe('SECURE_STORAGE_KEYS', () => {
  it('declares both registered keys with the binderly. namespace', () => {
    expect(SECURE_STORAGE_KEYS.themeOverride).toBe('binderly.theme.override');
    expect(SECURE_STORAGE_KEYS.supabaseSession).toBe('binderly.supabase.session');
  });

  it('keeps every key under the binderly. namespace', () => {
    for (const key of Object.values(SECURE_STORAGE_KEYS)) {
      expect(key).toMatch(/^binderly\./);
    }
  });
});

describe('getSecureStorage (native path)', () => {
  beforeEach(() => {
    vi.mocked(SecureStore.getItemAsync).mockClear();
    vi.mocked(SecureStore.setItemAsync).mockClear();
    vi.mocked(SecureStore.deleteItemAsync).mockClear();
  });

  it('round-trips a value via expo-secure-store', async () => {
    const storage = getSecureStorage();
    await storage.setItem(SECURE_STORAGE_KEYS.themeOverride, 'dark');
    const read = await storage.getItem(SECURE_STORAGE_KEYS.themeOverride);
    expect(read).toBe('dark');
  });

  it('returns null when a key has never been set', async () => {
    const storage = getSecureStorage();
    const read = await storage.getItem(SECURE_STORAGE_KEYS.supabaseSession);
    expect(read).toBeNull();
  });

  it('returns null after a removed key is read', async () => {
    const storage = getSecureStorage();
    await storage.setItem(SECURE_STORAGE_KEYS.themeOverride, 'light');
    await storage.removeItem(SECURE_STORAGE_KEYS.themeOverride);
    expect(await storage.getItem(SECURE_STORAGE_KEYS.themeOverride)).toBeNull();
  });

  it('removing a never-set key is a no-op', async () => {
    const storage = getSecureStorage();
    await expect(storage.removeItem(SECURE_STORAGE_KEYS.themeOverride)).resolves.toBeUndefined();
  });

  it('rejects non-string values at the type boundary', async () => {
    const storage = getSecureStorage();
    await expect(
      // Forcing a runtime violation past the type system; mirrors a
      // future caller that JSON.stringify'd `undefined`.
      storage.setItem(SECURE_STORAGE_KEYS.themeOverride, undefined as unknown as string),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it('forwards getItem to SecureStore.getItemAsync', async () => {
    const storage = getSecureStorage();
    await storage.getItem(SECURE_STORAGE_KEYS.supabaseSession);
    expect(SecureStore.getItemAsync).toHaveBeenCalledWith(SECURE_STORAGE_KEYS.supabaseSession);
  });

  it('forwards setItem to SecureStore.setItemAsync', async () => {
    const storage = getSecureStorage();
    await storage.setItem(SECURE_STORAGE_KEYS.supabaseSession, 'jwt');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      SECURE_STORAGE_KEYS.supabaseSession,
      'jwt',
    );
  });

  it('forwards removeItem to SecureStore.deleteItemAsync', async () => {
    const storage = getSecureStorage();
    await storage.removeItem(SECURE_STORAGE_KEYS.themeOverride);
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(SECURE_STORAGE_KEYS.themeOverride);
  });
});

describe('createInMemorySecureStorage (web fallback shape)', () => {
  it('round-trips without touching expo-secure-store', async () => {
    const storage = createInMemorySecureStorage();
    expect(await storage.getItem(SECURE_STORAGE_KEYS.themeOverride)).toBeNull();
    await storage.setItem(SECURE_STORAGE_KEYS.themeOverride, 'system');
    expect(await storage.getItem(SECURE_STORAGE_KEYS.themeOverride)).toBe('system');
    await storage.removeItem(SECURE_STORAGE_KEYS.themeOverride);
    expect(await storage.getItem(SECURE_STORAGE_KEYS.themeOverride)).toBeNull();
  });

  it('isolates instances from one another', async () => {
    const a = createInMemorySecureStorage();
    const b = createInMemorySecureStorage();
    await a.setItem(SECURE_STORAGE_KEYS.themeOverride, 'dark');
    expect(await b.getItem(SECURE_STORAGE_KEYS.themeOverride)).toBeNull();
  });
});

describe('supabaseSecureStoreAdapter', () => {
  beforeEach(() => {
    vi.mocked(SecureStore.getItemAsync).mockClear();
    vi.mocked(SecureStore.setItemAsync).mockClear();
    vi.mocked(SecureStore.deleteItemAsync).mockClear();
  });

  it('exposes the three keys Supabase JS calls', () => {
    expect(typeof supabaseSecureStoreAdapter.getItem).toBe('function');
    expect(typeof supabaseSecureStoreAdapter.setItem).toBe('function');
    expect(typeof supabaseSecureStoreAdapter.removeItem).toBe('function');
  });

  it('forwards getItem to the underlying secure store', async () => {
    await supabaseSecureStoreAdapter.getItem(SECURE_STORAGE_KEYS.supabaseSession);
    expect(SecureStore.getItemAsync).toHaveBeenCalledWith(SECURE_STORAGE_KEYS.supabaseSession);
  });

  it('forwards setItem and resolves to undefined', async () => {
    await expect(
      supabaseSecureStoreAdapter.setItem(SECURE_STORAGE_KEYS.supabaseSession, 'jwt-string'),
    ).resolves.toBeUndefined();
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      SECURE_STORAGE_KEYS.supabaseSession,
      'jwt-string',
    );
  });

  it('forwards removeItem', async () => {
    await supabaseSecureStoreAdapter.removeItem(SECURE_STORAGE_KEYS.supabaseSession);
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(SECURE_STORAGE_KEYS.supabaseSession);
  });

  it('round-trips a Supabase-shaped session payload', async () => {
    // Mirrors what Supabase JS persists: a JSON-encoded session
    // object with access + refresh tokens.
    const payload = JSON.stringify({
      access_token: 'eyJhbGc...',
      refresh_token: 'r-token',
      expires_at: 1717000000,
    });
    await supabaseSecureStoreAdapter.setItem(SECURE_STORAGE_KEYS.supabaseSession, payload);
    const read = await supabaseSecureStoreAdapter.getItem(SECURE_STORAGE_KEYS.supabaseSession);
    expect(read).toBe(payload);
  });
});
