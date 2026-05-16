// Tiny `useDebouncedValue` hook — defers value updates until the
// caller stops changing the input for `delayMs` milliseconds.
//
// Lifted out of the browse page because the search filter shares
// the pattern with future surfaces (collection search, smart-rule
// builder). Tests live next to the hook.

import { useEffect, useState } from 'react';

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    if (delayMs <= 0) {
      setDebounced(value);
      return undefined;
    }
    const handle = setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return (): void => {
      clearTimeout(handle);
    };
  }, [value, delayMs]);

  return debounced;
}
