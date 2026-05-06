// Typed wrapper around `expo-secure-store`.
//
// expo-secure-store maps to iOS Keychain and Android Keystore — both
// hardware-backed encrypted KV stores. The wrapper:
//
//   - Constrains keys to a typed registry so a typo can't silently
//     fork into a parallel slot.
//   - Always round-trips strings (Keychain stores bytes; we keep the
//     contract simple and let callers JSON-encode their payload).
//   - Provides a `Storage` adapter shaped like Supabase's
//     `SupportedStorage` interface so the Supabase JS client can use
//     it as the auth-session storage.
//   - Falls back to an in-memory map on the web target. This is NOT
//     part of the production surface; it exists so vitest + jsdom
//     test runs don't reach for the iOS Keychain. The mobile build
//     never hits this branch.
//
// Adding a new key is a one-line change to `SECURE_STORAGE_KEYS`.

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/** The registered keyspace. Adding a new key requires a 1-line edit here. */
export const SECURE_STORAGE_KEYS = {
  /** User's manual theme override (`'light' | 'dark' | 'system'`). */
  themeOverride: 'binderly.theme.override',
  /** Supabase JS auth session payload (managed by the SDK; we never read directly). */
  supabaseSession: 'binderly.supabase.session',
} as const;

export type SecureStorageKey = (typeof SECURE_STORAGE_KEYS)[keyof typeof SECURE_STORAGE_KEYS];

/**
 * Promise-based KV interface every consumer programs against. The
 * shape is intentionally narrow — no batch ops, no expiry — so we
 * can swap to `react-native-mmkv` for non-sensitive state in stage
 * 09 (T-OF-LOCAL-DB) without touching call sites.
 */
export interface SecureStorage {
  getItem(key: SecureStorageKey): Promise<string | null>;
  setItem(key: SecureStorageKey, value: string): Promise<void>;
  removeItem(key: SecureStorageKey): Promise<void>;
}

/**
 * Web fallback. Tests run under jsdom; this map keeps the same
 * contract without invoking the Keychain (which expo-secure-store
 * intentionally throws for on web). NOT used in any release build —
 * `Platform.OS` is `'ios'` or `'android'` on device.
 */
class InMemoryStorage implements SecureStorage {
  private readonly map = new Map<string, string>();
  public async getItem(key: SecureStorageKey): Promise<string | null> {
    return this.map.get(key) ?? null;
  }
  public async setItem(key: SecureStorageKey, value: string): Promise<void> {
    this.map.set(key, value);
  }
  public async removeItem(key: SecureStorageKey): Promise<void> {
    this.map.delete(key);
  }
}

class NativeSecureStorage implements SecureStorage {
  public async getItem(key: SecureStorageKey): Promise<string | null> {
    return SecureStore.getItemAsync(key);
  }
  public async setItem(key: SecureStorageKey, value: string): Promise<void> {
    if (typeof value !== 'string') {
      throw new TypeError(
        `secure-storage: setItem(${key}) requires a string value (got ${typeof value}).`,
      );
    }
    await SecureStore.setItemAsync(key, value);
  }
  public async removeItem(key: SecureStorageKey): Promise<void> {
    await SecureStore.deleteItemAsync(key);
  }
}

const storage: SecureStorage =
  Platform.OS === 'web' ? new InMemoryStorage() : new NativeSecureStorage();

/** Lazy-singleton accessor. Exported as a function so tests can replace it. */
export function getSecureStorage(): SecureStorage {
  return storage;
}

/**
 * Adapter shaped like Supabase JS's `SupportedStorage` interface.
 * Wired into `createClient(...)` as the `auth.storage` option so
 * the SDK persists JWTs in the OS Keychain instead of AsyncStorage.
 *
 * The Supabase SDK calls these synchronously-named methods that
 * actually return promises, which the secure-store API also does.
 */
export const supabaseSecureStoreAdapter = {
  getItem: (key: string): Promise<string | null> =>
    Platform.OS === 'web'
      ? storage.getItem(key as SecureStorageKey)
      : SecureStore.getItemAsync(key),
  setItem: (key: string, value: string): Promise<void> =>
    Platform.OS === 'web'
      ? storage.setItem(key as SecureStorageKey, value)
      : SecureStore.setItemAsync(key, value).then(() => undefined),
  removeItem: (key: string): Promise<void> =>
    Platform.OS === 'web'
      ? storage.removeItem(key as SecureStorageKey)
      : SecureStore.deleteItemAsync(key),
};

/**
 * Build a fresh in-memory storage instance. Tests replace the live
 * singleton with this when they need an isolated map per case.
 */
export function createInMemorySecureStorage(): SecureStorage {
  return new InMemoryStorage();
}
