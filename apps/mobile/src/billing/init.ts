// Lazy initializer for the mobile billing module.
//
// Public surface:
//
//   - `initializeBilling(opts)`: idempotent. Builds the right
//     adapter (real or stub) from the env keys + platform, calls
//     `Purchases.configure(...)` exactly once, and stores the
//     adapter as a module-level singleton.
//
//   - `getBillingAdapter()`: returns the current adapter. Falls
//     back to a stub if `initializeBilling()` hasn't been called
//     yet, so feature screens that read entitlements *before*
//     auth resolves don't crash — they just see "free tier".
//
//   - `useBillingBootstrap()`: React hook that wires
//     `initializeBilling()` to `useAuth()`. Mounts at the app
//     shell layer (above the screen tree); the screens never call
//     it directly. Handles:
//       * first-mount configure once auth resolves
//       * `logIn(newUserId)` when the user signs in
//       * `logOut()` when the user signs out
//
//   - `resetBillingForTesting()` / `setBillingAdapterForTesting()`:
//     test seams so each `*.test.ts` file starts from a clean
//     singleton and can inject mock adapters without dragging
//     `react-native-purchases` into jsdom.
//
// The "single warning, never crash" contract for the no-key
// degraded path lives here. We use a module-local boolean so the
// warning fires once per process (or test reset), not once per
// hook call.

import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import {
  createRealPurchasesAdapter,
  createStubPurchasesAdapter,
  type PurchasesAdapter,
} from './sdk.js';
import { useAuth } from '../components/providers/AuthProvider.js';


// ============================================================
// Singleton state
// ============================================================

let adapter: PurchasesAdapter | null = null;
let configuredFor: string | null = null;
let warnedAboutMissingKeys = false;

/**
 * Force-clear the singleton (and the "warned about missing keys"
 * flag). Tests call this in `afterEach` so adapter state never
 * leaks between assertions.
 */
export function resetBillingForTesting(): void {
  adapter = null;
  configuredFor = null;
  warnedAboutMissingKeys = false;
}

/**
 * Inject a mock adapter. Used by every hook test that doesn't
 * care about the real-RC path — most of them.
 */
export function setBillingAdapterForTesting(mock: PurchasesAdapter): void {
  adapter = mock;
  configuredFor = '__mock__';
}

// ============================================================
// initializeBilling
// ============================================================

export type BillingPlatform = 'ios' | 'android';

export interface BillingInitOptions {
  /** RC iOS API key, e.g. from `EXPO_PUBLIC_REVENUECAT_IOS_KEY`. */
  readonly iosKey: string | undefined;
  /** RC Android API key, e.g. from `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`. */
  readonly androidKey: string | undefined;
  /**
   * Override the auto-detected platform. Defaults to
   * `Platform.OS`. Tests pass an explicit value so RN's mocked
   * `Platform.OS` doesn't bleed through.
   */
  readonly platform?: BillingPlatform;
  /**
   * Supabase user id to identify the user against RevenueCat.
   * `null` triggers anonymous-mode configure.
   */
  readonly appUserId: string | null;
  /**
   * Test-only: swap `console.warn` for a fake. Lets a single
   * "log this once" assertion live in the init test file without
   * leaking global state via spies.
   */
  readonly warn?: (message: string) => void;
}

/**
 * Build (or return) the singleton billing adapter.
 *
 * Idempotent: subsequent calls with the same `appUserId` short-
 * circuit. Calls with a *different* `appUserId` route through
 * `logIn(newId)` instead of re-configuring (RC's documented
 * sign-in pattern).
 *
 * Dev-mode degradation: when both keys are unset (or the platform
 * has no key for it), we warn **once** and return a stub.
 */
export function initializeBilling(opts: BillingInitOptions): PurchasesAdapter {
  const platform: BillingPlatform = opts.platform ?? resolvePlatform();
  const apiKey = pickApiKey(opts.iosKey, opts.androidKey, platform);
  const warn = opts.warn ?? defaultWarn;

  // Path 1: already initialised, same user → no-op.
  if (adapter !== null && configuredFor === opts.appUserId) {
    return adapter;
  }

  // Path 2: already initialised, different user → logIn(...).
  // We fire-and-forget the logIn promise; the next
  // `getCustomerInfo()` will reflect the new identity. Errors get
  // logged but never crash the app — the worst case is the
  // entitlements query stays on the previous user until the next
  // refetch.
  if (adapter !== null && adapter.isConfigured) {
    if (opts.appUserId !== null) {
      void adapter.logIn(opts.appUserId).catch((cause) => {
        warn(`@binderly/mobile billing: logIn failed: ${describeError(cause)}`);
      });
    } else {
      void adapter.logOut().catch((cause) => {
        warn(`@binderly/mobile billing: logOut failed: ${describeError(cause)}`);
      });
    }
    configuredFor = opts.appUserId;
    return adapter;
  }

  // Path 3: first init.
  if (apiKey === null) {
    if (!warnedAboutMissingKeys) {
      warn(
        '@binderly/mobile billing: EXPO_PUBLIC_REVENUECAT_IOS_KEY / ' +
          'EXPO_PUBLIC_REVENUECAT_ANDROID_KEY are unset. Billing runs in ' +
          'dev-mode stub (free tier, no IAP). See apps/mobile/.env.example.',
      );
      warnedAboutMissingKeys = true;
    }
    adapter = createStubPurchasesAdapter();
    adapter.configure({ apiKey: 'dev-stub', appUserID: opts.appUserId });
    configuredFor = opts.appUserId;
    return adapter;
  }

  adapter = createRealPurchasesAdapter();
  adapter.configure({ apiKey, appUserID: opts.appUserId });
  configuredFor = opts.appUserId;
  return adapter;
}

/**
 * Return the current billing adapter. When billing hasn't been
 * initialised yet (the auth bootstrap hasn't fired), build a stub
 * on the fly — this keeps screens that read entitlements during
 * the boot-loading window from crashing. The real adapter
 * replaces the stub on the next `initializeBilling(...)` call.
 *
 * **Does NOT log the missing-keys warning** — that's
 * `initializeBilling`'s job. Calling `getBillingAdapter()` should
 * be a cheap, side-effect-free read.
 */
export function getBillingAdapter(): PurchasesAdapter {
  if (adapter === null) {
    const fallback = createStubPurchasesAdapter();
    fallback.configure({ apiKey: 'dev-stub', appUserID: null });
    adapter = fallback;
    configuredFor = null;
  }
  return adapter;
}

/** True iff a real (not stub) adapter is in place. */
export function isBillingConfigured(): boolean {
  return adapter !== null && adapter.isConfigured;
}

/** The user id the current adapter is associated with. */
export function getConfiguredAppUserId(): string | null {
  return configuredFor === '__mock__' ? null : configuredFor;
}

// ============================================================
// useBillingBootstrap — the React-side wiring
// ============================================================

export interface UseBillingBootstrapOptions {
  /** RC iOS API key (Expo-prefixed env var). */
  readonly iosKey: string | undefined;
  /** RC Android API key (Expo-prefixed env var). */
  readonly androidKey: string | undefined;
  /** Optional explicit platform — tests pass this in. */
  readonly platform?: BillingPlatform;
}

/**
 * Mount this at the app shell, above the screen tree, exactly
 * once. On every `useAuth()` transition:
 *
 *   - `loading: true` → wait.
 *   - `loading: false, session.user.id: X` → initialise +
 *     `logIn(X)` on change.
 *   - `loading: false, session: null` (was non-null) →
 *     `logOut()` + re-init in anonymous mode.
 *
 * No-ops on every render where the auth state hasn't moved
 * (compared by `user.id`), so re-renders are free.
 */
export function useBillingBootstrap(opts: UseBillingBootstrapOptions): void {
  const { session, loading } = useAuth();
  const lastUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (loading) return;
    const nextUserId = session?.user?.id ?? null;
    if (lastUserIdRef.current === nextUserId) return;
    lastUserIdRef.current = nextUserId;

    initializeBilling({
      iosKey: opts.iosKey,
      androidKey: opts.androidKey,
      platform: opts.platform,
      appUserId: nextUserId,
    });
  }, [loading, opts.androidKey, opts.iosKey, opts.platform, session?.user?.id]);
}

// ============================================================
// internals
// ============================================================

function resolvePlatform(): BillingPlatform {
  // Default to iOS when the OS isn't one we explicitly support —
  // keeps RC's configure call alive on the rare RN web build under
  // jsdom (where Platform.OS comes back as 'ios' from the test
  // mock anyway).
  return Platform.OS === 'android' ? 'android' : 'ios';
}

function pickApiKey(
  iosKey: string | undefined,
  androidKey: string | undefined,
  platform: BillingPlatform,
): string | null {
  const key = platform === 'ios' ? iosKey : androidKey;
  if (typeof key !== 'string' || key.length === 0) return null;
  return key;
}

function defaultWarn(message: string): void {
   
  console.warn(message);
}

function describeError(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return typeof cause === 'string' ? cause : 'unknown error';
}
