// `<ScanScreen>` — full continuous-scan UX.
//
// Closes Stage 06 by composing every scanner sub-system into one
// cohesive flow:
//
//   1. Auth gate — <ProtectedScreen> redirects unauthenticated users
//      to /auth/sign-in before any camera or model work happens.
//   2. Model loader — `useModelLoader` async-loads the embedding model
//      and ANN index; shows <ScannerLoading> or <ScannerError> while
//      the handles aren't ready.
//   3. Permission gate — <CameraPermissionPrompt> handles the 4-branch
//      native permission flow (not-determined / denied / restricted /
//      granted).
//   4. Live camera — `<CameraPreview>` from T-SC-CAMERA; active only
//      while permission is granted and the screen is focused.
//   5. Matcher — `useScanner()` from T-SC-MATCH subscribed to the
//      detect-stage detection sink; emits `MatchResult` events.
//   6. Match overlay — auto-add confirmation or disambiguation picker
//      depending on `disposition`.
//   7. Undo toast — 5-second window to reverse any auto-add.
//   8. Session footer — running count + "Done" button.
//   9. Stack review — StackPanel shown when phase === 'stack-review'.
//
// The `loadModels` prop is dependency-injected so tests can stub the
// binary-asset IO path. The production route file (scanner.tsx)
// passes the real loaders.

import { useRouter } from 'expo-router';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { Button, Text, XStack, YStack } from '@binderly/ui';

import { useModelLoader, type LoadModelsFn } from './use-model-loader.js';
import {
  printingToDisambigLookup,
  thumbnailUrlForPrinting,
  usePrinting,
} from './use-printing.js';
import { useScannerSession } from './use-scanner-session.js';
import { useApiClient } from '../../lib/api-client.js';
import { ProtectedScreen } from '../../lib/auth/index.js';
import {
  CameraPermissionPrompt,
  CameraPreview,
  createFrameTelemetrySink,
  createStackModeDetector,
  FpsDebugBadge,
  useCameraActive,
  useCameraPermissionFlow,
} from '../../scanner/camera/index.js';
import { createDetectionSink } from '../../scanner/detect/index.js';
import { useScanner } from '../../scanner/match/index.js';
import {
  DisambigPicker,
  MatchOverlay,
  ScannerError,
  ScannerLoading,
  SessionFooter,
  StackPanel,
  UndoToast,
  buildDisambigCandidates,
} from '../../scanner/ui/index.js';
import { UNDO_TIMEOUT_MS } from '../../scanner/ui/types.js';


import type { MatchResult } from '../../scanner/match/index.js';
import type { SessionItem } from '../../scanner/ui/types.js';

// ============================================================
// Helpers
// ============================================================

/** Dev-only FPS badge visibility gate. */
export const FPS_BADGE_VISIBLE_IN_DEV: boolean =
  typeof __DEV__ === 'boolean' ? __DEV__ : false;

/**
 * Warm-cache key for the embedding model + ANN index (FU-35). Stable
 * across `ScanScreen` remounts so a tab switch / back-navigate reuses
 * the already-loaded handles instead of re-warming. Only the
 * production path (no injected `loadModels`) opts in — see `ScanScreen`.
 */
export const SCANNER_MODEL_CACHE_KEY = 'scanner:embed+ann:bundled-v1';

function makeDisplayName(printingId: string): string {
  // Fallback label when the catalog lookup hasn't resolved yet (or
  // failed). The overlay + picker resolve the real name + thumbnail via
  // `usePrinting()` (FU-34); this is the graceful placeholder text.
  return printingId;
}

// ============================================================
// Props
// ============================================================

export interface ScanScreenProps {
  /**
   * Factory that returns the embed model + ANN index handles.
   * Dependency-injected for tests; the route file wires the real
   * loaders.
   */
  readonly loadModels?: LoadModelsFn;
  readonly testID?: string;
}

// ============================================================
// Inner screen (rendered inside <ProtectedScreen>)
// ============================================================

interface ScanScreenInnerProps {
  readonly loadModels: LoadModelsFn;
  /** Warm-cache key for the model loader; undefined in tests (FU-35). */
  readonly warmCacheKey?: string;
  readonly testID?: string;
}

function ScanScreenInner(props: ScanScreenInnerProps): ReactNode {
  const { loadModels, warmCacheKey, testID } = props;

  const router = useRouter();
  const client = useApiClient();

  // ---------- infrastructure ---------------------------------
  const permission = useCameraPermissionFlow();

  // Stable instances across re-renders.
  const telemetrySink = useMemo(() => createFrameTelemetrySink(), []);
  const stackModeDetector = useMemo(() => createStackModeDetector(), []);
  // The detect-stage frame processor observes events here; in tests
  // callers push events directly via `detectionSink.observe()`.
  const detectionSink = useMemo(() => createDetectionSink(), []);

  const cameraActive = useCameraActive({
    disabled: permission.status !== 'granted',
  });

  // ---------- model loader -----------------------------------
  const { loadState, handles, retry: retryLoad } = useModelLoader(
    warmCacheKey !== undefined ? { loadModels, warmCacheKey } : { loadModels },
  );

  // ---------- scanner hook -----------------------------------
  // Only wire when models are ready; pass stubs otherwise.
  const stubEmbed = useCallback(
    async (_crop: Float32Array): Promise<Float32Array> =>
      new Float32Array(0),
    [],
  );
  const stubSearch = useCallback(
    (_q: Float32Array, _k: number) => [] as const,
    [],
  );

  const embedCrop = useCallback(
    async (crop: Float32Array): Promise<Float32Array> => {
      if (handles === null) return new Float32Array(0);
      const w = Math.round(Math.sqrt(crop.length / 3));
      return handles.embedModel.embed({
        width: w,
        height: w,
        toArrayBuffer: () => crop.buffer as ArrayBuffer,
      });
    },
    [handles],
  );

  const searchKNN = useCallback(
    (query: Float32Array, k: number) => {
      if (handles === null) return [] as const;
      return handles.annIndex.searchKNN(query, k);
    },
    [handles],
  );

  const { sink: matchSink } = useScanner({
    detectionSink,
    embedCrop: loadState.phase === 'ready' ? embedCrop : stubEmbed,
    searchKNN: loadState.phase === 'ready' ? searchKNN : stubSearch,
  });

  // ---------- session state ----------------------------------
  const session = useScannerSession();
  const { state: sessionState } = session;

  // ---------- live match result ------------------------------
  const [liveMatch, setLiveMatch] = useState<MatchResult | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Subscribe to match sink events.
  useEffect(() => {
    const unsubscribe = matchSink.subscribe((result) => {
      setLiveMatch(result);
    });
    return unsubscribe;
  }, [matchSink]);

  // ---------- auto-add ----------------------------------------
  const handleAutoAdd = useCallback(
    async (printingId: string, matchResult: MatchResult): Promise<void> => {
      try {
        const item = await client.collection.addCollectionItem({
          printingId,
          source: 'scan',
        });
        const displayName = makeDisplayName(printingId);
        const sessionItem: SessionItem = {
          collectionItemId: item.id,
          printingId,
          displayName,
          committedAt: new Date().toISOString(),
          matchResult,
        };
        session.enqueueItem(sessionItem);
        session.setUndoEntry({
          collectionItemId: item.id,
          printingId,
          displayName,
          createdAtMs: performance.now(),
        });

        // Start undo timer — clears the undo entry after UNDO_TIMEOUT_MS.
        if (undoTimerRef.current !== null) {
          clearTimeout(undoTimerRef.current);
        }
        undoTimerRef.current = setTimeout(() => {
          session.setUndoEntry(null);
          undoTimerRef.current = null;
        }, UNDO_TIMEOUT_MS);
      } catch {
        // Swallow the error — the scanner stays running. A future
        // follow-up will surface a toast for write failures.
      }
    },
    [client, session],
  );

  const handleUndo = useCallback(async (): Promise<void> => {
    const entry = sessionState.undoEntry;
    if (entry === null) return;
    if (undoTimerRef.current !== null) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    session.setUndoEntry(null);
    session.removeItem(entry.collectionItemId);
    try {
      await client.collection.deleteCollectionItem({ id: entry.collectionItemId });
    } catch {
      // Swallow — item stays locally removed; server may auto-clean.
    }
  }, [client, session, sessionState.undoEntry]);

  // ---------- disambiguate ------------------------------------
  const [pendingDisambig, setPendingDisambig] = useState<MatchResult | null>(null);

  // ---------- catalog thumbnails (FU-34) ----------------------
  // Resolve the matched printing for the auto-add overlay and the
  // top-3 disambig candidates. Hooks are called unconditionally with a
  // possibly-undefined id so they obey the rules of hooks across the
  // screen's early returns; a null id keeps the fetch disabled.
  const autoAddPrintingId =
    liveMatch !== null && liveMatch.disposition === 'auto-add'
      ? liveMatch.printingId
      : undefined;
  const matchPrinting = usePrinting(autoAddPrintingId);

  const disambigCandidateMatches = pendingDisambig?.candidates ?? [];
  const candidate0 = usePrinting(disambigCandidateMatches[0]?.printingId);
  const candidate1 = usePrinting(disambigCandidateMatches[1]?.printingId);
  const candidate2 = usePrinting(disambigCandidateMatches[2]?.printingId);

  const disambigLookup = useCallback(
    (printingId: string) => {
      for (const c of [candidate0, candidate1, candidate2]) {
        if (c.printing !== null && c.printing.id === printingId) {
          return printingToDisambigLookup(printingId, c.printing);
        }
      }
      return printingToDisambigLookup(printingId, null);
    },
    [candidate0, candidate1, candidate2],
  );

  useEffect(() => {
    if (liveMatch === null) return;
    if (liveMatch.disposition === 'auto-add') {
      void handleAutoAdd(liveMatch.printingId, liveMatch);
      setLiveMatch(null);
    } else if (liveMatch.disposition === 'disambiguate') {
      setPendingDisambig(liveMatch);
      setLiveMatch(null);
    }
  }, [liveMatch, handleAutoAdd]);

  const handleDisambigConfirm = useCallback(
    (printingId: string): void => {
      if (pendingDisambig === null) return;
      void handleAutoAdd(printingId, pendingDisambig);
      setPendingDisambig(null);
    },
    [pendingDisambig, handleAutoAdd],
  );

  const handleDisambigDismiss = useCallback((): void => {
    setPendingDisambig(null);
  }, []);

  // ---------- stack review ------------------------------------
  const handleRemoveItem = useCallback(
    async (collectionItemId: string): Promise<void> => {
      session.removeItem(collectionItemId);
      try {
        await client.collection.deleteCollectionItem({ id: collectionItemId });
      } catch {
        // Swallow — item is already removed from local state.
      }
    },
    [client, session],
  );

  const handleDiscardAll = useCallback(async (): Promise<void> => {
    const items = [...sessionState.items];
    session.discardAll();
    await Promise.allSettled(
      items.map((item) =>
        client.collection.deleteCollectionItem({ id: item.collectionItemId }),
      ),
    );
  }, [client, session, sessionState.items]);

  const handleCommit = useCallback((): void => {
    session.commit();
  }, [session]);

  // ---------- navigation ------------------------------------
  const handleClose = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  }, [router]);

  // ---------- cleanup ----------------------------------------
  useEffect(() => {
    return () => {
      if (undoTimerRef.current !== null) {
        clearTimeout(undoTimerRef.current);
      }
    };
  }, []);

  // ==========================================================
  // Loading / error branches
  // ==========================================================

  if (loadState.phase === 'loading' || loadState.phase === 'idle') {
    return (
      <YStack flex={1} backgroundColor="$background" testID={testID ?? 'scan-screen'}>
        <ScannerLoading />
      </YStack>
    );
  }

  if (loadState.phase === 'error') {
    return (
      <YStack flex={1} backgroundColor="$background" testID={testID ?? 'scan-screen'}>
        <ScannerError error={loadState.error} onRetry={retryLoad} />
      </YStack>
    );
  }

  // ==========================================================
  // Permission gate
  // ==========================================================

  if (permission.status !== 'granted') {
    return (
      <YStack flex={1} backgroundColor="$background" testID={testID ?? 'scan-screen'}>
        <ScanHeader onClose={handleClose} />
        <CameraPermissionPrompt
          status={permission.status}
          onRequestPermission={permission.requestPermission}
          onOpenSettings={permission.openSettings}
        />
      </YStack>
    );
  }

  // ==========================================================
  // Stack review panel
  // ==========================================================

  if (sessionState.phase === 'stack-review') {
    return (
      <YStack flex={1} backgroundColor="$background" testID={testID ?? 'scan-screen'}>
        <ScanHeader onClose={handleClose} title="Review" />
        <StackPanel
          items={sessionState.items}
          onRemoveItem={(id) => void handleRemoveItem(id)}
          onCommit={handleCommit}
          onDiscardAll={() => void handleDiscardAll()}
        />
      </YStack>
    );
  }

  // ==========================================================
  // Live scanner (camera + overlays)
  // ==========================================================

  const disambigCandidates =
    pendingDisambig !== null
      ? buildDisambigCandidates(pendingDisambig.candidates, disambigLookup)
      : [];

  return (
    <YStack flex={1} backgroundColor="$background" testID={testID ?? 'scan-screen'}>
      {/* Live camera fills the screen */}
      <CameraPreview
        isActive={cameraActive}
        telemetrySink={telemetrySink}
        stackModeDetector={stackModeDetector}
      />

      {/* Top bar — close + FPS badge */}
      <XStack
        position="absolute"
        top={0}
        left={0}
        right={0}
        padding="$3"
        justifyContent="space-between"
        alignItems="center"
        pointerEvents="box-none"
      >
        <Button
          variant="ghost"
          onPress={handleClose}
          testID="scan-screen-close"
          accessibilityLabel="Close scanner"
          accessibilityRole="button"
        >
          Close
        </Button>
        <FpsDebugBadge sink={telemetrySink} visible={FPS_BADGE_VISIBLE_IN_DEV} />
      </XStack>

      {/* Match overlay — mid-screen when an auto-add just fired */}
      {liveMatch !== null && liveMatch.disposition === 'auto-add' && (
        <XStack
          position="absolute"
          top="$12"
          left="$4"
          right="$4"
          pointerEvents="none"
        >
          <MatchOverlay
            printingName={
              matchPrinting.printing?.card.name ??
              makeDisplayName(liveMatch.printingId)
            }
            setName={matchPrinting.printing?.set.name ?? ''}
            collectorNumber={matchPrinting.printing?.card.number ?? ''}
            thumbnailUrl={thumbnailUrlForPrinting(matchPrinting.printing)}
            stabilityCount={liveMatch.stabilityCount}
            confidence={liveMatch.confidence}
          />
        </XStack>
      )}

      {/* Undo toast — above the session footer */}
      {sessionState.undoEntry !== null && (
        <XStack
          position="absolute"
          bottom="$16"
          left="$4"
          right="$4"
        >
          <UndoToast
            displayName={sessionState.undoEntry.displayName}
            onUndo={() => void handleUndo()}
          />
        </XStack>
      )}

      {/* Session footer — persists at the bottom */}
      <YStack position="absolute" bottom={0} left={0} right={0}>
        <SessionFooter
          itemCount={sessionState.items.length}
          onDone={() => session.enterStackReview()}
        />
      </YStack>

      {/* Disambiguation picker — bottom sheet */}
      {pendingDisambig !== null && (
        <YStack
          position="absolute"
          bottom={0}
          left={0}
          right={0}
        >
          <DisambigPicker
            candidates={disambigCandidates}
            onConfirm={handleDisambigConfirm}
            onDismiss={handleDisambigDismiss}
          />
        </YStack>
      )}

      {/* Hold-steady hint while scanner is actively tracking but
          no match has fired yet (isMatching && no liveMatch). */}
    </YStack>
  );
}

// ============================================================
// Public export — wraps inner screen with auth gate
// ============================================================

/**
 * Default `loadModels` stub used when the screen is mounted without
 * explicit injection (e.g. in the Expo Router tab route). In v1 beta
 * the real binary assets aren't bundled yet; this stub satisfies the
 * hook's interface by resolving immediately to a pair of no-op
 * handles. Replace with real loaders when the asset pipeline is ready.
 *
 * The stub is intentionally kept behind this function so the tree-
 * shaker removes it from the production bundle once a real factory
 * is wired.
 */
function createStubLoadModels(): LoadModelsFn {
  return async () => {
    const embedModel = {
      embeddingDim: 128,
      delegate: 'cpu' as const,
      isUsingGpu: false,
      modelName: 'stub',
      modelVersion: '0.0.0',
      embed: async () => new Float32Array(128),
      dispose: () => {},
    };
    const annIndex = {
      dim: 128,
      count: 0,
      format: 'flat' as const,
      metric: 'cosine' as const,
      dtype: 'float32' as const,
      name: 'stub',
      version: '0.0.0',
      embeddingModelName: 'stub',
      embeddingModelVersion: '0.0.0',
      embeddingModelHash: '',
      searchKNN: () => [],
      dispose: () => {},
    };
    return { embedModel, annIndex };
  };
}

export function ScanScreen(props: ScanScreenProps): ReactNode {
  const injectedLoadModels = props.loadModels;
  const loadModels = useMemo(
    () => injectedLoadModels ?? createStubLoadModels(),
    [injectedLoadModels],
  );

  // Only the production path (no injected loader) opts into the warm
  // cache (FU-35). Tests inject a fresh stub loader per render and
  // assert per-mount load / error behaviour, so caching them under a
  // shared key would leak results across renders — keep them uncached.
  const warmCacheKey =
    injectedLoadModels === undefined ? SCANNER_MODEL_CACHE_KEY : undefined;

  return (
    <ProtectedScreen>
      <ScanScreenInner
        loadModels={loadModels}
        {...(warmCacheKey !== undefined ? { warmCacheKey } : {})}
        testID={props.testID}
      />
    </ProtectedScreen>
  );
}

// ============================================================
// Internal sub-components
// ============================================================

interface ScanHeaderProps {
  readonly onClose: () => void;
  readonly title?: string;
}

function ScanHeader({ onClose, title }: ScanHeaderProps): ReactNode {
  return (
    <XStack
      padding="$3"
      justifyContent="space-between"
      alignItems="center"
      backgroundColor="$background"
    >
      <Button
        variant="ghost"
        onPress={onClose}
        testID="scan-screen-close"
        accessibilityLabel="Close scanner"
        accessibilityRole="button"
      >
        Close
      </Button>
      {title !== undefined && (
        <Text variant="subtitle" tone="default">
          {title}
        </Text>
      )}
    </XStack>
  );
}
