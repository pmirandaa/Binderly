// connectivity.ts — thin wrapper over @react-native-community/netinfo
// for online/offline detection.
//
// Note: the brief mentioned expo-network, but the mobile package.json
// has @react-native-community/netinfo (v11.4.1), which is already mocked
// in src/test-utils/setup.ts. Using netinfo avoids a new dependency.

import NetInfo from '@react-native-community/netinfo';

type ConnectivityListener = (online: boolean) => void;

/**
 * Returns true if the device has connectivity (isConnected &&
 * isInternetReachable). Treats null as true to avoid blocking replay
 * on ambiguous states.
 */
export async function isOnline(): Promise<boolean> {
  const state = await NetInfo.fetch();
  // isInternetReachable can be null on some platforms — treat as reachable
  return (state.isConnected ?? true) && (state.isInternetReachable ?? true);
}

/**
 * Subscribe to connectivity changes. Listener is called with the new
 * online state whenever connectivity changes. Returns an unsubscribe
 * function.
 */
export function onConnectivityChange(listener: ConnectivityListener): () => void {
  return NetInfo.addEventListener((state) => {
    const online = (state.isConnected ?? true) && (state.isInternetReachable ?? true);
    listener(online);
  });
}
