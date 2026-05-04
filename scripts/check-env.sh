#!/usr/bin/env bash
# check-env.sh — Validate a target env file against `.env.example`.
#
# Usage:
#   bash scripts/check-env.sh <target-env-file>
#   pnpm check:env                          # wrapper for `.env.local`
#
# Rules (also documented in docs/env.md):
#   1. Every var name declared in .env.example MUST be present in the
#      target. Value can be empty (for non-required vars) but the
#      `NAME=` line must exist.
#   2. No extra vars in the target unless the comment line directly
#      above contains `# EXTRA-OK` (escape hatch for per-developer or
#      pre-canonicalised vars).
#   3. Blank lines and comment lines are ignored on both sides.
#
# Exit codes:
#   0  clean match
#   1  usage error or missing file
#   2  drift: missing and/or extra vars
#
# The summary line is always one of:
#   OK: <N> vars match
#   FAIL: <M> missing, <K> extra
#
# Followed by a named diff when FAIL.

set -euo pipefail

# --- locate repo root -----------------------------------------------------
# Try `git rev-parse` first (handles worktrees correctly); fall back to
# the parent of `scripts/` for non-git checkouts (zip downloads etc.).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if REPO_ROOT="$(git -C "${SCRIPT_DIR}" rev-parse --show-toplevel 2>/dev/null)"; then
  :
else
  REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
fi

SOURCE="${REPO_ROOT}/.env.example"

usage() {
  cat >&2 <<EOF
Usage: $(basename "$0") <target-env-file>
Example: $(basename "$0") .env.local

Validates <target> against $SOURCE. Every var in $SOURCE must be
present in <target>; extras require '# EXTRA-OK' on the line above.
EOF
  exit 1
}

[[ $# -eq 1 ]] || usage
case "$1" in -h|--help) usage ;; esac

TARGET="$1"
# Allow callers to pass a path relative to the repo root.
if [[ ! -f "${TARGET}" && -f "${REPO_ROOT}/${TARGET}" ]]; then
  TARGET="${REPO_ROOT}/${TARGET}"
fi

if [[ ! -f "${SOURCE}" ]]; then
  echo "ERROR: source file not found: ${SOURCE}" >&2
  exit 1
fi
if [[ ! -f "${TARGET}" ]]; then
  echo "ERROR: target file not found: ${TARGET}" >&2
  exit 1
fi

# --- extract VAR names ----------------------------------------------------
# `extract_vars FILE`: print one var name per line in declaration order.
# Comments (`#...`) and blank lines are skipped. A line is treated as a
# var declaration if it matches `^[A-Za-z_][A-Za-z0-9_]*=`.
extract_vars() {
  awk '
    /^[[:space:]]*$/ { next }
    /^[[:space:]]*#/ { next }
    {
      line = $0
      sub(/^[[:space:]]+/, "", line)
      n = index(line, "=")
      if (n > 0) {
        name = substr(line, 1, n-1)
        sub(/[[:space:]]+$/, "", name)
        if (name ~ /^[A-Za-z_][A-Za-z0-9_]*$/) {
          print name
        }
      }
    }
  ' "$1"
}

# `extract_target_with_extra_ok FILE`: print "<name> <flag>" per line,
# where <flag> is 1 iff the comment line directly above carried
# `# EXTRA-OK`. Blank lines reset the flag (so EXTRA-OK only marks the
# next var declaration, not arbitrarily later ones).
extract_target_with_extra_ok() {
  awk '
    BEGIN { extra_ok = 0 }
    /^[[:space:]]*$/ { extra_ok = 0; next }
    /^[[:space:]]*#/ {
      if ($0 ~ /#[[:space:]]*EXTRA-OK([[:space:]:]|$)/) {
        extra_ok = 1
      } else {
        extra_ok = 0
      }
      next
    }
    {
      line = $0
      sub(/^[[:space:]]+/, "", line)
      n = index(line, "=")
      if (n > 0) {
        name = substr(line, 1, n-1)
        sub(/[[:space:]]+$/, "", name)
        if (name ~ /^[A-Za-z_][A-Za-z0-9_]*$/) {
          print name " " extra_ok
          extra_ok = 0
        }
      }
    }
  ' "$1"
}

src_vars_sorted="$(extract_vars "${SOURCE}" | sort -u)"
tgt_pairs="$(extract_target_with_extra_ok "${TARGET}")"
tgt_vars_sorted="$(printf '%s\n' "${tgt_pairs}" | awk 'NF{print $1}' | sort -u)"

# --- diff -----------------------------------------------------------------
# Missing: in source but not in target.
missing="$(comm -23 \
  <(printf '%s\n' "${src_vars_sorted}") \
  <(printf '%s\n' "${tgt_vars_sorted}") )"

# Extras: in target but not in source.
extras_raw="$(comm -13 \
  <(printf '%s\n' "${src_vars_sorted}") \
  <(printf '%s\n' "${tgt_vars_sorted}") )"

# Filter out extras that were tagged `# EXTRA-OK`. We loop because we
# need to look up each name's flag from the (unsorted) tgt_pairs map.
# Use process substitution (`< <(...)`) instead of a here-string to
# avoid bash needing a temp file (matters in sandboxed CI runners).
filtered_extras=""
while IFS= read -r v; do
  [[ -z "$v" ]] && continue
  flag="$(printf '%s\n' "${tgt_pairs}" \
    | awk -v var="$v" '$1==var {print $2; exit}')"
  if [[ "${flag}" != "1" ]]; then
    filtered_extras+="${v}"$'\n'
  fi
done < <(printf '%s\n' "${extras_raw}")

# --- counts ---------------------------------------------------------------
count_lines() {
  # Count non-empty lines.
  printf '%s' "$1" | awk 'NF{n++} END{print n+0}'
}
src_count="$(count_lines "${src_vars_sorted}")"
missing_count="$(count_lines "${missing}")"
extras_count="$(count_lines "${filtered_extras}")"

# --- report ---------------------------------------------------------------
if [[ "${missing_count}" -eq 0 && "${extras_count}" -eq 0 ]]; then
  echo "OK: ${src_count} vars match"
  exit 0
fi

echo "FAIL: ${missing_count} missing, ${extras_count} extra"
echo

if [[ "${missing_count}" -gt 0 ]]; then
  echo "Missing in ${TARGET} (declared in $(basename "${SOURCE}")):"
  printf '%s\n' "${missing}" | awk 'NF{print "  - " $0}'
  echo
fi

if [[ "${extras_count}" -gt 0 ]]; then
  echo "Extra in ${TARGET} (not in $(basename "${SOURCE}"); tag a comment"
  echo "line above with '# EXTRA-OK' to allow):"
  printf '%s\n' "${filtered_extras}" | awk 'NF{print "  + " $0}'
fi

exit 2
