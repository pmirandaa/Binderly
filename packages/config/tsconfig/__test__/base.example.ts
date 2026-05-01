// Smoke test for `base.json`. Exercises strict mode, noUncheckedIndexedAccess
// (the safe form), ES2022 syntax (top-level `as const`, optional chaining,
// nullish coalescing), and bundler-style module resolution.

export type FirstResult<T> =
  | { readonly kind: "some"; readonly value: T }
  | { readonly kind: "none" };

export function safeFirst<T>(arr: readonly T[]): FirstResult<T> {
  const value: T | undefined = arr[0];
  return value === undefined ? { kind: "none" } : { kind: "some", value };
}

const sample = [1, 2, 3] as const;
const result: FirstResult<number> = safeFirst(sample);

export const HAS_VALUE: boolean = result.kind === "some";
export const FIRST: number | null = result.kind === "some" ? result.value : null;
