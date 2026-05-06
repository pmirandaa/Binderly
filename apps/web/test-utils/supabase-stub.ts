// Minimal Supabase stub used by AuthProvider tests. Implements
// just the surface the provider touches: `auth.getSession`,
// `auth.onAuthStateChange`, `auth.signOut`. Tests can drive
// state by calling `emit(session)` to simulate an auth change.

import { vi } from 'vitest';

import type { Session, SupabaseClient } from '@supabase/supabase-js';

export interface FakeSupabase {
  client: SupabaseClient;
  emit: (next: Session | null) => void;
  signOut: ReturnType<typeof vi.fn>;
  getSession: ReturnType<typeof vi.fn>;
  onAuthStateChange: ReturnType<typeof vi.fn>;
}

export function createFakeSupabase(initial: Session | null = null): FakeSupabase {
  let listeners: Array<(event: string, session: Session | null) => void> = [];
  const getSession = vi.fn(async () => ({ data: { session: initial }, error: null }));
  const signOut = vi.fn(async () => ({ error: null }));
  const onAuthStateChange = vi.fn((cb: (event: string, session: Session | null) => void) => {
    listeners.push(cb);
    return {
      data: {
        subscription: {
          id: 'fake',
          callback: cb,
          unsubscribe: () => {
            listeners = listeners.filter((l) => l !== cb);
          },
        },
      },
    };
  });
  const auth = { getSession, signOut, onAuthStateChange };
  const client = { auth } as unknown as SupabaseClient;
  return {
    client,
    emit: (next) => {
      for (const cb of listeners) cb('SIGNED_IN', next);
    },
    signOut,
    getSession,
    onAuthStateChange,
  };
}
