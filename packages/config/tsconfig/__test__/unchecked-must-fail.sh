#!/usr/bin/env bash
# Asserts that `noUncheckedIndexedAccess` is actually enforced by `base.json`.
#
# Strategy: compile the contrived failing fixture under a tsconfig that
# extends `base.json`. Compilation MUST fail (non-zero exit) and the diagnostic
# MUST be the expected TS2322 ("not assignable") complaint about
# `number | undefined`. If either of those is not true, the test fails.
set -uo pipefail

PKG_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PKG_DIR"

LOG_FILE="$(mktemp -t binderly-tsconfig-unchecked.XXXXXX)"
trap 'rm -f "$LOG_FILE"' EXIT

if pnpm exec tsc --noEmit -p __test__/tsconfig.no-unchecked-fail.json \
    >"$LOG_FILE" 2>&1; then
  echo "FAIL: tsc compiled the contrived noUncheckedIndexedAccess fixture without error." >&2
  echo "      That means the flag is NOT being applied by base.json." >&2
  echo "      tsc output was:" >&2
  sed 's/^/        /' "$LOG_FILE" >&2
  exit 1
fi

if ! grep -qE "TS2322|is not assignable to type 'number'" "$LOG_FILE"; then
  echo "FAIL: tsc errored, but not with the expected TS2322/'not assignable' diagnostic." >&2
  echo "      tsc output was:" >&2
  sed 's/^/        /' "$LOG_FILE" >&2
  exit 1
fi

echo "OK: noUncheckedIndexedAccess correctly flagged unsafe array access (TS2322)."
exit 0
