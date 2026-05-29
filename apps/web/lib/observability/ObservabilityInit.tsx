'use client';

// Mount-once observability bootstrap. Rendered high in the web root
// layout so the init seam runs on every page, client-side. It renders
// nothing.
//
// SCAFFOLDING MODE (Stage 11, T-DP-MONITORING): with no `hooks` wired
// (see `./index`) this effect is a no-op today. At go-live, pass the
// real Sentry / PostHog initializers from a thin SDK wrapper — see
// `infra/monitoring/README.md`.

import { useEffect } from 'react';

import { initWebObservability } from './index';

export function ObservabilityInit(): null {
  useEffect(() => {
    initWebObservability();
  }, []);
  return null;
}
