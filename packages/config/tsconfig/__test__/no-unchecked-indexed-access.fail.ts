// CONTRIVED FAILING EXAMPLE — this file MUST fail to compile under
// `base.json`. It proves that `noUncheckedIndexedAccess: true` is in effect:
// indexing a `readonly number[]` should yield `number | undefined`, not
// `number`, so the assignment below is rejected.
//
// This file is gated behind `__test__/tsconfig.no-unchecked-fail.json` and
// `__test__/unchecked-must-fail.sh`, which expects `tsc` to exit non-zero
// with TS2322. Do NOT include this file from any other tsconfig.

const arr: readonly number[] = [1, 2, 3];

// Without noUncheckedIndexedAccess, `arr[0]` would be `number` and this
// would compile. With the flag on, `arr[0]` is `number | undefined` and
// the explicit `: number` annotation on `value` triggers TS2322.
const value: number = arr[0];

export const ONE: number = value;
