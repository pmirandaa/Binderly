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
  return {
    Slot,
    Stack,
    Tabs,
    Link,
    Redirect,
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
    AppState: {
      addEventListener: vi.fn(() => ({ remove: vi.fn() })),
      currentState: 'active',
    },
  };
});

// ---- cleanup --------------------------------------------------------
afterEach(() => {
  cleanup();
  secureStorageMap.clear();
  netInfoListeners.clear();
  mockColorScheme = 'light';
});

// Export the live secure-storage map so individual tests can pre-seed
// keys when needed. Keeping it co-located with the mock means tests
// don't have to duplicate the in-memory model.
export const __secureStorageMap = secureStorageMap;
