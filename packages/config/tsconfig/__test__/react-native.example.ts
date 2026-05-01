// Smoke test for `react-native.json`. Exercises pure ES2022 features that
// the React Native runtime supports (Map, Promise, async/await) without
// requiring the React Native types to be installed in this config-only
// package. Real RN apps add `react-native` + `@types/react` themselves.

export function makeIndex<K extends string, V>(
  pairs: ReadonlyArray<readonly [K, V]>,
): ReadonlyMap<K, V> {
  const out = new Map<K, V>();
  for (const pair of pairs) {
    const key: K | undefined = pair[0];
    const value: V | undefined = pair[1];
    if (key !== undefined && value !== undefined) {
      out.set(key, value);
    }
  }
  return out;
}

export async function nextTick<T>(value: T): Promise<T> {
  return Promise.resolve(value);
}

export const SAMPLE: ReadonlyMap<"a" | "b", number> = makeIndex([
  ["a", 1],
  ["b", 2],
] as const);
