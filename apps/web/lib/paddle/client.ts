// Paddle.js (browser SDK) wrapper.
//
// Three responsibilities:
//
//   1. `loadPaddle(env)` — lazy-initialize the SDK with the public
//      client token + environment. Lazy-loaded so the SDK isn't
//      bundled into pages that don't need it (and so SSR never
//      tries to import it). Wires `eventCallback` to a mutable
//      listener registry so callers can subscribe / unsubscribe
//      per checkout flow without re-initialising the SDK.
//   2. `openCheckout(paddle, args)` — open the overlay checkout
//      with `priceId` + `customData.userId`. Thin wrapper, exists
//      so the billing UI never reaches into the SDK directly.
//   3. `subscribeToCheckoutEvent(name, handler)` — register a
//      one-shot listener for a Paddle checkout event. Used by the
//      billing route to invalidate the entitlements query after
//      a successful checkout.
//
// `customData.userId` is the *single* link between a Paddle
// purchase and a Binderly user — Paddle propagates it through the
// transaction → subscription → webhook chain unmodified.

import type { PaddleEnvironment } from './env';
import type { Paddle, CheckoutOpenOptions, PaddleEventData } from '@paddle/paddle-js';


export interface LoadPaddleArgs {
  readonly clientToken: string;
  readonly environment: PaddleEnvironment;
}

type CheckoutEventListener = (event: PaddleEventData) => void;

let cachedPaddle: Paddle | null = null;
let cachedToken: string | null = null;
let cachedEnv: PaddleEnvironment | null = null;
const eventListeners: Set<CheckoutEventListener> = new Set();

/**
 * Initialise the Paddle SDK. Returns the live `Paddle` instance,
 * or `null` when the SDK declines to initialise (e.g. the script
 * was blocked by a content blocker — that surface degrades to
 * "Could not start checkout" in the UI).
 *
 * The function memoizes by `(token, environment)`. Calling it
 * twice with the same args returns the same instance; changing
 * either rebuilds.
 */
export async function loadPaddle(args: LoadPaddleArgs): Promise<Paddle | null> {
  if (typeof window === 'undefined') return null;
  if (
    cachedPaddle !== null &&
    cachedToken === args.clientToken &&
    cachedEnv === args.environment
  ) {
    return cachedPaddle;
  }
  // Dynamic import keeps Paddle.js out of the SSR bundle. Even
  // though `'use client'` files don't render server-side, Next.js's
  // bundler still pre-bundles statically-imported deps for the
  // client. The dynamic form lets the bundler split it into its
  // own chunk that only loads on `/billing`.
  const mod = await import('@paddle/paddle-js');
  const paddle = await mod.initializePaddle({
    token: args.clientToken,
    environment: args.environment,
    eventCallback: (event: PaddleEventData) => {
      for (const listener of eventListeners) listener(event);
    },
  });
  if (paddle === undefined) return null;
  cachedPaddle = paddle;
  cachedToken = args.clientToken;
  cachedEnv = args.environment;
  return paddle;
}

/**
 * Subscribe to Paddle checkout events. Returns an unsubscribe
 * function. Mutiple subscribers are supported; we fan-out from a
 * single SDK-level `eventCallback` registered at init time.
 */
export function subscribeToCheckoutEvents(listener: CheckoutEventListener): () => void {
  eventListeners.add(listener);
  return (): void => {
    eventListeners.delete(listener);
  };
}

export interface OpenCheckoutArgs {
  readonly priceId: string;
  readonly userId: string;
  /**
   * Optional success URL — e.g. `https://binderly.app/billing?status=ok`.
   * When unset, Paddle keeps the user on the checkout page until they
   * close it manually and the post-success redirect is the default
   * "thank you" page configured in the Paddle dashboard.
   */
  readonly successUrl?: string;
  /** Optional analytics-only metadata stored alongside `userId`. */
  readonly extraCustomData?: Record<string, string>;
}

/**
 * Open the Paddle overlay checkout. Throws if `paddle` is null or
 * `priceId` / `userId` is empty — caller is expected to filter
 * those at the UI layer (disabled button, missing-env placeholder).
 */
export function openCheckout(paddle: Paddle, args: OpenCheckoutArgs): void {
  if (args.priceId.length === 0) {
    throw new Error('openCheckout: priceId is required.');
  }
  if (args.userId.length === 0) {
    throw new Error('openCheckout: userId is required.');
  }

  const options: CheckoutOpenOptions = {
    items: [{ priceId: args.priceId, quantity: 1 }],
    customData: {
      userId: args.userId,
      source: 'binderly-web',
      ...(args.extraCustomData ?? {}),
    },
    settings:
      args.successUrl !== undefined && args.successUrl.length > 0
        ? { successUrl: args.successUrl }
        : undefined,
  };

  paddle.Checkout.open(options);
}

/** Test-only: drop the cached instance so a fresh build can use stub deps. */
export function __resetPaddleCacheForTests(): void {
  cachedPaddle = null;
  cachedToken = null;
  cachedEnv = null;
  eventListeners.clear();
}
