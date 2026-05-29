// `usePrinting` — resolve a catalog printing (name / set / collector
// number / thumbnail URL) by id for the scanner overlays (FU-34).
//
// The matcher already carries the catalog `printing.id` on every
// `MatchResult` + ANN candidate, so the thumbnail + names can be
// resolved with the existing `client.cards.getPrinting()` read — no
// api-client or match-pipeline change is needed.
//
// This hook lives in the screen layer (not `scanner/ui/`) on purpose:
// the `scanner/ui/` tree is guarded by a network-isolation test, so the
// pure components there take a resolved `thumbnailUrl` prop and this
// hook does the IO. A small module-scope LRU dedups repeats across
// remounts and across the auto-add overlay vs the disambig picker
// (scanning the same card twice doesn't re-fetch).
//
// We deliberately keep this as a lightweight `useEffect` + `useState`
// reader rather than a TanStack-Query hook so the scanner screen's
// existing test tree (which wraps only `<UIProvider>`, no
// `<QueryClientProvider>`) keeps working; the api-client is read
// through the same `useApiClient()` context every other surface uses.

import { useEffect, useState } from 'react';

import type { PrintingWithContextDto } from '@binderly/api-contracts';

import { useApiClient } from '../../lib/api-client.js';

import type { DisambigLookupResult } from '../../scanner/ui/index.js';

// Module-scope dedup cache. Bounded so a long stack-scan session can't
// grow it without limit; insertion-order eviction is a fine "LRU-ish"
// for a thumbnail cache.
const PRINTING_CACHE_CAP = 64;
const printingCache = new Map<string, PrintingWithContextDto>();

function rememberPrinting(id: string, dto: PrintingWithContextDto): void {
  if (!printingCache.has(id) && printingCache.size >= PRINTING_CACHE_CAP) {
    const oldest = printingCache.keys().next().value;
    if (oldest !== undefined) {
      printingCache.delete(oldest);
    }
  }
  printingCache.set(id, dto);
}

/** Test hook — clear the dedup cache so it doesn't leak across files. */
export function __resetPrintingCache(): void {
  printingCache.clear();
}

/** Pick the best available thumbnail URL for a printing (small first). */
export function thumbnailUrlForPrinting(
  printing: PrintingWithContextDto | null | undefined,
): string | null {
  if (printing === null || printing === undefined) {
    return null;
  }
  return printing.imageSmallUrl ?? printing.imageLargeUrl ?? null;
}

/** Build the `DisambigPicker` lookup row for a resolved printing. */
export function printingToDisambigLookup(
  id: string,
  printing: PrintingWithContextDto | null | undefined,
): DisambigLookupResult {
  if (printing === null || printing === undefined) {
    return { displayName: id, setName: '', collectorNumber: '', thumbnailUrl: null };
  }
  return {
    displayName: printing.card.name,
    setName: printing.set.name,
    collectorNumber: printing.card.number,
    thumbnailUrl: thumbnailUrlForPrinting(printing),
  };
}

export interface UsePrintingResult {
  readonly printing: PrintingWithContextDto | null;
  readonly isLoading: boolean;
  readonly isError: boolean;
}

/**
 * Resolve a single printing by id. A `null` / empty id disables the
 * fetch (returns an idle result), so callers can invoke the hook
 * unconditionally while the id is still pending.
 */
export function usePrinting(printingId: string | null | undefined): UsePrintingResult {
  const client = useApiClient();

  const seed =
    printingId !== null && printingId !== undefined
      ? printingCache.get(printingId) ?? null
      : null;
  const [printing, setPrinting] = useState<PrintingWithContextDto | null>(seed);
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    if (printingId === null || printingId === undefined || printingId.length === 0) {
      setPrinting(null);
      setIsLoading(false);
      setIsError(false);
      return;
    }

    const cached = printingCache.get(printingId);
    if (cached !== undefined) {
      setPrinting(cached);
      setIsLoading(false);
      setIsError(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setPrinting(null);
    setIsLoading(true);
    setIsError(false);

    void (async () => {
      try {
        const result = await client.cards.getPrinting({
          id: printingId,
          signal: controller.signal,
        });
        if (cancelled) return;
        rememberPrinting(printingId, result);
        setPrinting(result);
        setIsLoading(false);
      } catch {
        if (cancelled) return;
        // Any failure (404 / offline / abort) degrades to the
        // placeholder — the scanner stays usable without a thumbnail.
        setIsError(true);
        setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [client, printingId]);

  return { printing, isLoading, isError };
}
