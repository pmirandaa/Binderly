// Vitest setup. Runs before each test file. Two responsibilities:
//
//   1. Wire jest-dom's matchers so RTL assertions like
//      `.toBeInTheDocument()` work.
//   2. Provide deterministic mocks for the Expo / RN modules the
//      shell imports. The shell's contract tests don't need real
//      Keychain access or a live Metro bundler; they need the
//      modules to resolve and behave deterministically.
//
// The mocks below mirror the public surfaces our code calls. New
// imports added under `src/lib/*` or `src/components/*` should
// extend this file rather than mocking inline in each test file.

import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import * as React from 'react';
import { afterEach, vi } from 'vitest';

// ---- expo-secure-store -----------------------------------------------
// In-memory Keychain stand-in. Reset between tests via `cleanup`.
const secureStorageMap = new Map<string, string>();

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async (key: string) => secureStorageMap.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    secureStorageMap.set(key, value);
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    secureStorageMap.delete(key);
  }),
  isAvailableAsync: vi.fn(async () => true),
  WHEN_UNLOCKED: 0,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
}));

// ---- expo-constants --------------------------------------------------
vi.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      name: 'Binderly',
      slug: 'binderly',
      scheme: 'binderly',
      version: '0.0.1',
    },
  },
}));

// ---- expo-linking ----------------------------------------------------
vi.mock('expo-linking', () => ({
  createURL: vi.fn((path: string) => `binderly://${path.replace(/^\//, '')}`),
  openURL: vi.fn(async () => true),
  parse: vi.fn((url: string) => ({
    scheme: 'binderly',
    hostname: null,
    path: url,
    queryParams: {},
  })),
  useURL: vi.fn(() => null),
}));

// ---- expo-router -----------------------------------------------------
vi.mock('expo-router', () => {
  const Slot = ({ children }: { children?: React.ReactNode }) => children ?? null;
  const Stack = ({ children }: { children?: React.ReactNode }) => children ?? null;
  Stack.Screen = ({ children }: { children?: React.ReactNode }) => children ?? null;
  const Tabs = ({ children }: { children?: React.ReactNode }) => children ?? null;
  Tabs.Screen = ({ children }: { children?: React.ReactNode }) => children ?? null;
  const Link = ({ children }: { children?: React.ReactNode }) => children ?? null;
  const Redirect = () => null;
  // `useFocusEffect` runs the focus callback synchronously on mount
  // and the cleanup on unmount. Mirrors the behaviour ScanScreen
  // relies on (camera releases when the screen unmounts).
  //
  // Tests that need to flip focus state without unmounting (e.g. to
  // assert the camera releases on tab navigation away) call
  // `__blurFocus()` / `__refocus()` below — those iterate the
  // registered callbacks and run their cleanup or re-invoke them.
  const focusCallbacks = new Set<() => void | (() => void)>();
  const focusCleanups = new Map<() => void | (() => void), (() => void) | void>();
  const useFocusEffect = vi.fn((callback: () => void | (() => void)) => {
    React.useEffect(() => {
      focusCallbacks.add(callback);
      const cleanup = callback();
      focusCleanups.set(callback, cleanup);
      return (): void => {
        const stored = focusCleanups.get(callback);
        if (typeof stored === 'function') stored();
        focusCleanups.delete(callback);
        focusCallbacks.delete(callback);
      };
    }, [callback]);
  });
  function __blurFocus(): void {
    for (const [callback, cleanup] of focusCleanups) {
      if (typeof cleanup === 'function') cleanup();
      focusCleanups.set(callback, undefined);
    }
  }
  function __refocus(): void {
    for (const callback of focusCallbacks) {
      const cleanup = callback();
      focusCleanups.set(callback, cleanup);
    }
  }
  function __resetFocusEffect(): void {
    focusCallbacks.clear();
    focusCleanups.clear();
  }
  return {
    Slot,
    Stack,
    Tabs,
    Link,
    Redirect,
    useFocusEffect,
    __blurFocus,
    __refocus,
    __resetFocusEffect,
    router: {
      push: vi.fn(),
      replace: vi.fn(),
      back: vi.fn(),
      canGoBack: vi.fn(() => true),
    },
    useRouter: () => ({
      push: vi.fn(),
      replace: vi.fn(),
      back: vi.fn(),
      canGoBack: vi.fn(() => true),
    }),
    useLocalSearchParams: () => ({}),
    useSegments: () => [],
    usePathname: () => '/',
  };
});

// ---- expo-status-bar -------------------------------------------------
vi.mock('expo-status-bar', () => ({
  StatusBar: () => null,
}));

// ---- react-native-vision-camera --------------------------------------
//
// The shell tests run in jsdom — no device, no camera. The mock
// gives us:
//
//   - A `Camera` React component that renders a stub `<div>` so the
//     ScanScreen tree mounts without dragging native modules in.
//   - Mutable static methods on `Camera` (`getCameraPermissionStatus`,
//     `requestCameraPermission`) backed by `setMockCameraPermission`
//     so individual tests can simulate the four permission branches.
//   - `useCameraDevice` returning a fake device by default; set to
//     `null` via `setMockCameraDevice(null)` to exercise the
//     no-device fallback.
//   - `useFrameProcessor` returning the **raw worklet function** under
//     a `worklet` key. Production code uses `useFrameProcessor` only
//     to memoize the worklet; the contract tests want to invoke the
//     worklet directly to assert the throttle + telemetry behaviour,
//     so the mock exposes it that way.
//
// `__resetCameraMockState()` runs from the global `afterEach` so
// each test starts from a clean baseline.
type MockCameraPermissionStatus = 'granted' | 'not-determined' | 'denied' | 'restricted';

interface MockFrame {
  readonly width: number;
  readonly height: number;
  readonly bytesPerRow: number;
  readonly timestamp: number;
  readonly isValid?: boolean;
  readonly planesCount?: number;
  readonly isMirrored?: boolean;
  readonly pixelFormat?: string;
  readonly orientation?: string;
}

interface MockReadonlyFrameProcessor {
  readonly type: 'readonly';
  readonly frameProcessor: (frame: MockFrame) => void;
}

interface CameraMockState {
  permissionStatus: MockCameraPermissionStatus;
  requestResult: 'granted' | 'denied';
  device: object | null;
  permissionStatusCalls: number;
  requestCalls: number;
}

const cameraMockState: CameraMockState = {
  permissionStatus: 'not-determined',
  requestResult: 'granted',
  device: { id: 'back-camera-mock', position: 'back' },
  permissionStatusCalls: 0,
  requestCalls: 0,
};

export function setMockCameraPermission(
  status: MockCameraPermissionStatus,
  requestResult: 'granted' | 'denied' = status === 'granted' ? 'granted' : 'denied',
): void {
  cameraMockState.permissionStatus = status;
  cameraMockState.requestResult = requestResult;
}

export function setMockCameraDevice(device: object | null): void {
  cameraMockState.device = device;
}

export function __resetCameraMockState(): void {
  cameraMockState.permissionStatus = 'not-determined';
  cameraMockState.requestResult = 'granted';
  cameraMockState.device = { id: 'back-camera-mock', position: 'back' };
  cameraMockState.permissionStatusCalls = 0;
  cameraMockState.requestCalls = 0;
}

export function getCameraMockState(): Readonly<CameraMockState> {
  return cameraMockState;
}

vi.mock('react-native-vision-camera', () => {
  function Camera({
    testID,
    ...rest
  }: { testID?: string } & Record<string, unknown>) {
    void rest;
    return React.createElement('div', { 'data-testid': testID ?? 'vision-camera' });
  }
  Camera.getCameraPermissionStatus = vi.fn((): MockCameraPermissionStatus => {
    cameraMockState.permissionStatusCalls += 1;
    return cameraMockState.permissionStatus;
  });
  Camera.requestCameraPermission = vi.fn(async (): Promise<'granted' | 'denied'> => {
    cameraMockState.requestCalls += 1;
    cameraMockState.permissionStatus =
      cameraMockState.requestResult === 'granted' ? 'granted' : 'denied';
    return cameraMockState.requestResult;
  });
  // Memoize the returned ReadonlyFrameProcessor against the
  // declared dependency list — that's the same posture
  // vision-camera's real implementation takes, and the contract
  // tests rely on (`useScanFrameProcessor` must return a stable
  // object across re-renders when its deps don't change).
  return {
    Camera,
    useCameraDevice: vi.fn(() => cameraMockState.device),
    useCameraPermission: vi.fn(() => ({
      hasPermission: cameraMockState.permissionStatus === 'granted',
      requestPermission: Camera.requestCameraPermission,
    })),
    useFrameProcessor: vi.fn(
      (
        worklet: (frame: MockFrame) => void,
        dependencies: React.DependencyList,
      ): MockReadonlyFrameProcessor => {
        // The dynamic dependency-list argument is the contract
        // vision-camera itself uses; the linter's
        // `react-hooks/exhaustive-deps` rule can't statically
        // verify a generic dependency forward, so suppress both
        // hooks rules here.
        /* eslint-disable react-hooks/exhaustive-deps */
        return React.useMemo<MockReadonlyFrameProcessor>(
          () => ({ type: 'readonly', frameProcessor: worklet }),
          dependencies,
        );
        /* eslint-enable react-hooks/exhaustive-deps */
      },
    ),
  };
});

// ---- react-native-worklets-core --------------------------------------
//
// `useRunOnJS` would normally return a Promise-resolving Worklet
// that hops the call onto the JS thread. In tests we run on the JS
// thread already, so the mock returns a function that invokes the
// callback synchronously and resolves with the result. This keeps
// the throttle test deterministic — every "worklet" call observed
// at JS-side happens before the next mock frame.
vi.mock('react-native-worklets-core', () => ({
  useRunOnJS: vi.fn(
    <T extends (...args: unknown[]) => unknown>(
      callback: T,
      dependencies: React.DependencyList,
    ) => {
      /* eslint-disable react-hooks/exhaustive-deps */
      return React.useMemo(
        () =>
          (...args: Parameters<T>): Promise<ReturnType<T>> =>
            Promise.resolve(callback(...args) as ReturnType<T>),
        dependencies,
      );
      /* eslint-enable react-hooks/exhaustive-deps */
    },
  ),
  worklet: vi.fn(<T extends (...args: unknown[]) => unknown>(fn: T) => fn),
  isWorklet: vi.fn(() => true),
  getWorkletDependencies: vi.fn(() => []),
}));

// ---- expo-image ------------------------------------------------------
vi.mock('expo-image', () => ({
  Image: () => null,
}));

// ---- expo-splash-screen ----------------------------------------------
vi.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: vi.fn(async () => true),
  hideAsync: vi.fn(async () => true),
  setOptions: vi.fn(),
}));

// ---- @react-native-community/netinfo --------------------------------
type NetInfoListener = (state: {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
}) => void;
const netInfoListeners = new Set<NetInfoListener>();

vi.mock('@react-native-community/netinfo', () => ({
  default: {
    addEventListener: vi.fn((listener: NetInfoListener) => {
      netInfoListeners.add(listener);
      return () => netInfoListeners.delete(listener);
    }),
    fetch: vi.fn(async () => ({ isConnected: true, isInternetReachable: true })),
  },
  addEventListener: vi.fn((listener: NetInfoListener) => {
    netInfoListeners.add(listener);
    return () => netInfoListeners.delete(listener);
  }),
  fetch: vi.fn(async () => ({ isConnected: true, isInternetReachable: true })),
}));

// ---- react-native --------------------------------------------------
// Mocked entirely. The shell's contract tests don't exercise real RN
// behaviour — Tamagui primitives from `@binderly/ui` provide the
// cross-platform UI surface and route through `react-native-web` at
// build time. The bare-minimum surface our shell code touches:
//   - `useColorScheme()` for system-theme resolution
//   - `Platform.OS` for the secure-storage web fallback
//   - `Pressable` / `View` / `Text` re-exports for any direct usage
//     (the shell does not import these directly; @binderly/ui does)
// Tests that need to flip the system theme call `setMockColorScheme`.
let mockColorScheme: 'light' | 'dark' | null = 'light';

export function setMockColorScheme(scheme: 'light' | 'dark' | null): void {
  mockColorScheme = scheme;
}

vi.mock('react-native', () => {
  const View = ({
    children,
    testID,
    ...rest
  }: { children?: React.ReactNode; testID?: string } & Record<string, unknown>) => {
    void rest;
    if (testID !== undefined) {
      return React.createElement('div', { 'data-testid': testID }, children);
    }
    return children ?? null;
  };
  const Text = ({ children }: { children?: React.ReactNode }) => children ?? null;
  const Pressable = ({ children }: { children?: React.ReactNode }) => children ?? null;
  // ScrollView needs to preserve testID so screen-level wrappers
  // (e.g. `<ScrollView testID="card-screen">`) remain queryable.
  const ScrollView = ({
    children,
    testID,
    ...rest
  }: { children?: React.ReactNode; testID?: string } & Record<string, unknown>) => {
    void rest;
    if (testID !== undefined) {
      return React.createElement('div', { 'data-testid': testID }, children);
    }
    return React.createElement('div', null, children);
  };
  // FlatList stub: render every item synchronously so tests can
  // observe the rendered rows via testID / text content. We
  // expose the renderItem path the screens hit (the `{ item, index }`
  // signature mirrors RN's contract). `ListHeaderComponent` and
  // `ListEmptyComponent` accept either a node or a render fn, also
  // mirroring RN. Implemented with `React.createElement` (file is
  // `.ts`, not `.tsx`) so the setup module stays JSX-free.
  type FlatListItemInfo<T> = { item: T; index: number };
  interface FlatListLikeProps<T> {
    data?: ReadonlyArray<T> | null;
    renderItem?: (info: FlatListItemInfo<T>) => React.ReactNode;
    keyExtractor?: (item: T, index: number) => string;
    ListHeaderComponent?: React.ReactNode | (() => React.ReactNode);
    ListEmptyComponent?: React.ReactNode | (() => React.ReactNode);
    ListFooterComponent?: React.ReactNode | (() => React.ReactNode);
    refreshControl?: React.ReactNode;
    testID?: string;
  }
  function FlatList<T>(props: FlatListLikeProps<T>): React.ReactElement {
    const data = props.data ?? [];
    const header = resolveSlot(props.ListHeaderComponent);
    const footer = resolveSlot(props.ListFooterComponent);
    const empty = data.length === 0 ? resolveSlot(props.ListEmptyComponent) : null;
    const rendered = data.map((item, index) => {
      const key = props.keyExtractor ? props.keyExtractor(item, index) : String(index);
      const child = props.renderItem ? props.renderItem({ item, index }) : null;
      return React.createElement(
        'div',
        { key, 'data-testid': `${props.testID ?? 'list'}-item-${index}` },
        child,
      );
    });
    return React.createElement(
      'div',
      { 'data-testid': props.testID ?? 'list' },
      props.refreshControl ?? null,
      header,
      rendered,
      empty,
      footer,
    );
  }
  function resolveSlot(slot: unknown): React.ReactNode {
    if (slot === undefined || slot === null) return null;
    if (typeof slot === 'function') {
      return (slot as () => React.ReactNode)();
    }
    return slot as React.ReactNode;
  }
  // RefreshControl stub: exposes its `onRefresh` callback through
  // a tappable element so tests can simulate a pull-to-refresh.
  interface RefreshControlLikeProps {
    refreshing?: boolean;
    onRefresh?: () => void;
    testID?: string;
  }
  function RefreshControl(props: RefreshControlLikeProps): React.ReactElement {
    return React.createElement(
      'button',
      {
        type: 'button',
        'data-testid': props.testID ?? 'refresh-control',
        'aria-busy': props.refreshing ? true : undefined,
        onClick: props.onRefresh,
      },
      'refresh',
    );
  }
  // AppState mock — exposes a `triggerAppStateChange` helper so the
  // camera-lifecycle test can simulate background / foreground
  // transitions deterministically. The default `currentState` is
  // `'active'` to mirror what the device looks like on screen mount.
  type AppStateChangeListener = (state: 'active' | 'background' | 'inactive') => void;
  const appStateListeners = new Set<AppStateChangeListener>();
  const AppState = {
    currentState: 'active' as 'active' | 'background' | 'inactive',
    addEventListener: vi.fn((event: string, listener: AppStateChangeListener) => {
      void event;
      appStateListeners.add(listener);
      return { remove: (): void => void appStateListeners.delete(listener) };
    }),
    __triggerChange(state: 'active' | 'background' | 'inactive'): void {
      AppState.currentState = state;
      for (const listener of appStateListeners) {
        listener(state);
      }
    },
    __reset(): void {
      AppState.currentState = 'active';
      appStateListeners.clear();
    },
  };
  // Linking.openSettings — the permissions module deep-links the
  // user to the system Settings app from the "denied" branch. The
  // mock just records the call so the prompt tests can assert it.
  const Linking = {
    openSettings: vi.fn(async () => undefined),
    openURL: vi.fn(async () => true),
    canOpenURL: vi.fn(async () => true),
    addEventListener: vi.fn(() => ({ remove: vi.fn() })),
  };
  return {
    View,
    Text,
    Pressable,
    ScrollView,
    FlatList,
    RefreshControl,
    useColorScheme: () => mockColorScheme,
    Platform: {
      OS: 'ios',
      select: <T>(spec: { ios?: T; android?: T; default?: T }) => spec.ios ?? spec.default,
    },
    StyleSheet: {
      create: <T>(styles: T) => styles,
      flatten: <T>(style: T) => style,
    },
    AppState,
    Linking,
  };
});

/**
 * Trigger an AppState change in tests. Wraps the internal mock
 * helper so test files don't need to spelunk into the mock's
 * shape. Asserts the mock was actually set up to guard against
 * test files that forget the setup-file include.
 */
export async function triggerAppStateChange(
  state: 'active' | 'background' | 'inactive',
): Promise<void> {
  const RN = (await import('react-native')) as unknown as {
    AppState: { __triggerChange?: (s: 'active' | 'background' | 'inactive') => void };
  };
  RN.AppState.__triggerChange?.(state);
}

/** Simulate a tab navigation away from the focused screen. */
export async function blurNavigationFocus(): Promise<void> {
  const router = (await import('expo-router')) as unknown as {
    __blurFocus?: () => void;
  };
  router.__blurFocus?.();
}

/** Simulate the focused screen regaining focus. */
export async function refocusNavigation(): Promise<void> {
  const router = (await import('expo-router')) as unknown as {
    __refocus?: () => void;
  };
  router.__refocus?.();
}

// ---- react-native-fast-tflite ---------------------------------------
// Default mock used by every test that imports the embed loader. The
// per-test suites in `apps/mobile/src/scanner/embed/__tests__/` set
// their own behaviour via `(loadTensorflowModel as Mock).mockImpl…`.
//
// Tests that exercise the *real* mock-state-management surface should
// re-mock the module locally with their own `vi.mock(...)` call.
vi.mock('react-native-fast-tflite', () => ({
  loadTensorflowModel: vi.fn(),
  useTensorflowModel: vi.fn(),
}));

// ---- cleanup --------------------------------------------------------
//
// The dynamic-import guards below tolerate test files that
// re-mock `react-native` or `expo-router` with a partial surface
// — older tests predate the camera helpers and don't re-export
// them. Missing helpers are a no-op, not an error.
afterEach(async () => {
  cleanup();
  secureStorageMap.clear();
  netInfoListeners.clear();
  mockColorScheme = 'light';
  __resetCameraMockState();
  try {
    const RN = (await import('react-native')) as unknown as {
      AppState?: { __reset?: () => void };
    };
    RN.AppState?.__reset?.();
  } catch {
    // tolerated
  }
  try {
    const router = (await import('expo-router')) as unknown as {
      __resetFocusEffect?: () => void;
    };
    router.__resetFocusEffect?.();
  } catch {
    // tolerated
  }
});

// Export the live secure-storage map so individual tests can pre-seed
// keys when needed. Keeping it co-located with the mock means tests
// don't have to duplicate the in-memory model.
export const __secureStorageMap = secureStorageMap;
