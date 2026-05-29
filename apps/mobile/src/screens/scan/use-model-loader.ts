// `useModelLoader` — async loader for the embedding model + ANN index.
//
// The scanner screen needs both handles before it can wire
// `useScanner()`. This hook manages the loading lifecycle and
// exposes a `ModelLoadState` the screen can branch on.
//
// Production path: calls `loadEmbeddingModel` + `loadAnnIndex` from
// the scanner sub-modules. The actual binary assets (TFLite model +
// HNSW index binary) live in R2 and are resolved by the loaders via
// expo-asset's local-URI mechanism. For v1 beta this hook accepts
// injected `load*` functions so tests can stub the entire IO path.
//
// The hook disposes both handles on unmount.

import { useCallback, useEffect, useRef, useState } from 'react';

import { getOrLoadWarmModels } from '../../scanner/model-cache.js';

import type { AnnIndexHandle } from '../../scanner/ann/types.js';
import type { EmbeddingModelHandle } from '../../scanner/embed/types.js';
import type { ModelLoadState } from '../../scanner/ui/types.js';

export interface ModelHandles {
  readonly embedModel: EmbeddingModelHandle;
  readonly annIndex: AnnIndexHandle;
}

export type LoadModelsFn = () => Promise<ModelHandles>;

export interface UseModelLoaderOptions {
  /**
   * Injected loader function. In production the screen wires the
   * real asset loaders; tests inject deterministic stubs.
   */
  readonly loadModels: LoadModelsFn;
  /**
   * If `true`, the hook won't start loading until explicitly
   * triggered via the returned `retry()` function. Defaults to
   * `false` (loads immediately on mount).
   */
  readonly lazy?: boolean;
  /**
   * Opt into the module-level warm cache (FU-35). When set, the loaded
   * handles are kept warm across `ScanScreen` remounts under this key
   * (which should be derived from the model + index asset identity), so
   * a tab switch / back-navigate skips the ~200–400 ms re-warm.
   *
   * When provided, the hook does **not** dispose the handles on unmount
   * — the cache owns their (indefinite) lifetime. Omit it (the default)
   * to keep the legacy per-mount load + dispose behaviour, which is what
   * tests that inject a fresh stub loader per render want.
   */
  readonly warmCacheKey?: string;
}

export interface UseModelLoaderResult {
  readonly loadState: ModelLoadState;
  readonly handles: ModelHandles | null;
  /** Re-trigger the load (e.g. after an error). */
  retry(): void;
}

export function useModelLoader(options: UseModelLoaderOptions): UseModelLoaderResult {
  const { loadModels, lazy = false, warmCacheKey } = options;

  const [loadState, setLoadState] = useState<ModelLoadState>(
    lazy ? { phase: 'idle', error: null } : { phase: 'loading', error: null },
  );
  const [handles, setHandles] = useState<ModelHandles | null>(null);
  const [retryToken, setRetryToken] = useState<number>(lazy ? -1 : 0);

  // Keep a ref to the most recent handles so the cleanup
  // function can dispose them even after the state has cleared.
  const handlesRef = useRef<ModelHandles | null>(null);

  useEffect(() => {
    if (retryToken < 0) {
      // Lazy mode and no explicit retry yet — stay idle.
      return;
    }

    let cancelled = false;

    setLoadState({ phase: 'loading', error: null });
    setHandles(null);

    (async () => {
      try {
        const loaded =
          warmCacheKey !== undefined
            ? await getOrLoadWarmModels(warmCacheKey, loadModels)
            : await loadModels();
        if (cancelled) {
          // The warm cache owns the handles' lifetime; only the
          // non-cached path disposes a load that finished after unmount.
          if (warmCacheKey === undefined) {
            loaded.embedModel.dispose();
            loaded.annIndex.dispose();
          }
          return;
        }
        handlesRef.current = loaded;
        setHandles(loaded);
        setLoadState({ phase: 'ready', error: null });
      } catch (cause: unknown) {
        if (cancelled) return;
        const error =
          cause instanceof Error ? cause : new Error('Model load failed.');
        setLoadState({ phase: 'error', error });
        setHandles(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadModels, retryToken, warmCacheKey]);

  // Dispose handles on unmount — but only when this mount owns them.
  // Warm-cached handles outlive the component by design (FU-35), so
  // disposing them here would break the next mount that reuses them.
  useEffect(() => {
    return () => {
      if (warmCacheKey === undefined) {
        handlesRef.current?.embedModel.dispose();
        handlesRef.current?.annIndex.dispose();
      }
      handlesRef.current = null;
    };
  }, [warmCacheKey]);

  const retry = useCallback((): void => {
    setRetryToken((t) => (t < 0 ? 0 : t + 1));
  }, []);

  return { loadState, handles, retry };
}
