#!/usr/bin/env bash
# cleanup_worktree.sh — Tear down a sub-agent's worktree + branch after merge.
#
# Usage:
#   scripts/cleanup_worktree.sh <task-id> [--force]
#
# Behaviour:
#   - Validates <task-id> against the canonical regex.
#   - Reads scripts/orchestrator.config.json for branch + worktree prefixes
#     and the main branch name.
#   - "Is this task merged?" detection: scans the most recent N commit
#     subjects on main (default N=200, override with BINDERLY_MERGE_LOG_DEPTH)
#     for one that begins with "<task-id>:". This matches the orchestrator's
#     squash-merge title convention (e.g. "T-FN-MONOREPO: Initialize ...").
#   - Without --force: refuses if the task is not detected as merged AND the
#     branch is not an ancestor of main.
#   - With --force: skips the merge check and uses `git worktree remove
#     --force` (handles dirty trees) and `git branch -D` (force-delete).
#   - Prunes stale `.git/worktrees/*` entries at the end so a re-run finds a
#     clean slate. Idempotent: if neither worktree nor branch exists, exits
#     0 with an informational message.
#
# Exit codes:
#   64  bad usage
#   65  bad task id
#   66  config / main missing
#   69  refuses (not merged, no --force)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "${SCRIPT_DIR}" rev-parse --show-toplevel)"
CONFIG_FILE="${REPO_ROOT}/scripts/orchestrator.config.json"

usage() {
  cat >&2 <<EOF
Usage: $(basename "$0") <task-id> [--force]

Removes the worktree at ../binderly-wt-<task-id> and deletes the branch
agent/<task-id>. Refuses unless the task appears merged on main; pass
--force to override (use after a manual squash merge that hasn't yet been
fast-forwarded into local main, or to abandon a failed sub-agent).
EOF
  exit 64
}

# --- parse args -----------------------------------------------------------
FORCE=0
TASK_ID=""
for arg in "$@"; do
  case "${arg}" in
    --force) FORCE=1 ;;
    -h|--help) usage ;;
    -*) echo "ERROR: unknown flag: ${arg}" >&2; usage ;;
    *)
      if [[ -n "${TASK_ID}" ]]; then
        echo "ERROR: multiple task ids given" >&2
        usage
      fi
      TASK_ID="${arg}"
      ;;
  esac
done
[[ -n "${TASK_ID}" ]] || usage

# --- validate task id format ----------------------------------------------
TASK_ID_REGEX='^T-[A-Z]{2}-[A-Z0-9-]+$'
if [[ ! "${TASK_ID}" =~ ${TASK_ID_REGEX} ]]; then
  echo "ERROR: task id '${TASK_ID}' does not match ${TASK_ID_REGEX}" >&2
  exit 65
fi

# --- read config ----------------------------------------------------------
if [[ ! -f "${CONFIG_FILE}" ]]; then
  echo "ERROR: config file not found: ${CONFIG_FILE}" >&2
  exit 66
fi

read_json_string() {
  local key="$1" file="$2"
  grep -oE "\"${key}\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" "${file}" \
    | sed -E "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\"([^\"]*)\".*/\1/" \
    | head -n1
}

BRANCH_PREFIX="$(read_json_string branch_prefix "${CONFIG_FILE}")"
WORKTREE_PREFIX="$(read_json_string worktree_prefix "${CONFIG_FILE}")"
MAIN_BRANCH="$(read_json_string default_main_branch "${CONFIG_FILE}")"
: "${BRANCH_PREFIX:?missing branch_prefix in ${CONFIG_FILE}}"
: "${WORKTREE_PREFIX:?missing worktree_prefix in ${CONFIG_FILE}}"
: "${MAIN_BRANCH:?missing default_main_branch in ${CONFIG_FILE}}"

BRANCH="${BRANCH_PREFIX}${TASK_ID}"

# Resolve the worktree path the same way spawn_worktree.sh does.
WORKTREE_REL="${WORKTREE_PREFIX}${TASK_ID}"
WORKTREE_PARENT_REL="$(dirname "${WORKTREE_REL}")"
WORKTREE_BASENAME="$(basename "${WORKTREE_REL}")"
# The parent directory may not exist if a previous cleanup already wiped it
# AND the user removed the dir; tolerate that.
if WORKTREE_PARENT_ABS="$(cd "${REPO_ROOT}" && cd "${WORKTREE_PARENT_REL}" 2>/dev/null && pwd)"; then
  WORKTREE_ABS="${WORKTREE_PARENT_ABS}/${WORKTREE_BASENAME}"
else
  WORKTREE_ABS="${REPO_ROOT}/${WORKTREE_REL}"
fi

if ! git -C "${REPO_ROOT}" show-ref --verify --quiet "refs/heads/${MAIN_BRANCH}"; then
  echo "ERROR: main branch '${MAIN_BRANCH}' not found locally" >&2
  exit 66
fi

# --- "is task merged?" check ----------------------------------------------
# We use squash-merge commit titles ("<task-id>: ...") because that is the
# orchestrator's actual merge convention (see commits T-FN-MONOREPO:,
# T-FN-GITHUB:, etc.). N is bounded so we don't walk all of history.
LOG_DEPTH="${BINDERLY_MERGE_LOG_DEPTH:-200}"

is_merged_by_title() {
  git -C "${REPO_ROOT}" log --format=%s "${MAIN_BRANCH}" -n "${LOG_DEPTH}" \
    | grep -qE "^${TASK_ID}:"
}

# Fallback: maybe somebody merged with --no-ff and the title doesn't carry
# the marker. If the branch's tip is reachable from main *and* differs from
# main's tip (i.e. the sub-agent made commits and they all landed), treat it
# as merged. We exclude the branch_tip == main_tip case explicitly because
# squash-merging detaches the original branch tip from main's reachability —
# so an "ancestor" relationship there only means the sub-agent did zero work,
# not that work was merged.
is_merged_by_ancestry() {
  git -C "${REPO_ROOT}" show-ref --verify --quiet "refs/heads/${BRANCH}" || return 1
  local branch_tip main_tip
  branch_tip="$(git -C "${REPO_ROOT}" rev-parse "${BRANCH}")"
  main_tip="$(git -C "${REPO_ROOT}" rev-parse "${MAIN_BRANCH}")"
  [[ "${branch_tip}" != "${main_tip}" ]] || return 1
  git -C "${REPO_ROOT}" merge-base --is-ancestor "${BRANCH}" "${MAIN_BRANCH}" 2>/dev/null
}

if [[ "${FORCE}" -ne 1 ]]; then
  if is_merged_by_title; then
    echo "Detected merge marker '${TASK_ID}:' in last ${LOG_DEPTH} commits on ${MAIN_BRANCH}."
  elif is_merged_by_ancestry; then
    echo "Branch '${BRANCH}' is an ancestor of ${MAIN_BRANCH}; treating as merged."
  else
    echo "ERROR: '${TASK_ID}' does not appear merged into ${MAIN_BRANCH}." >&2
    echo "       Searched last ${LOG_DEPTH} commits for '${TASK_ID}:' subject" >&2
    echo "       and checked branch ancestry." >&2
    echo "Hint: pass --force to remove anyway (e.g. abandoned sub-agent)." >&2
    exit 69
  fi
fi

# --- remove the worktree --------------------------------------------------
WORKTREE_REGISTERED=0
if git -C "${REPO_ROOT}" worktree list --porcelain \
    | grep -qE "^worktree ${WORKTREE_ABS}$"; then
  WORKTREE_REGISTERED=1
fi

if [[ "${WORKTREE_REGISTERED}" -eq 1 ]]; then
  if [[ "${FORCE}" -eq 1 ]]; then
    git -C "${REPO_ROOT}" worktree remove --force "${WORKTREE_ABS}"
  else
    git -C "${REPO_ROOT}" worktree remove "${WORKTREE_ABS}"
  fi
  echo "Removed worktree: ${WORKTREE_ABS}"
elif [[ -e "${WORKTREE_ABS}" ]]; then
  echo "WARN: ${WORKTREE_ABS} exists on disk but is not a registered worktree" >&2
  echo "      Refusing to rm -rf; remove manually if intended." >&2
else
  echo "Worktree path '${WORKTREE_ABS}' already absent — nothing to remove."
fi

# --- prune stale .git/worktrees/* entries (lock files etc.) ---------------
# Safe to run even when nothing was removed; it's a no-op then.
git -C "${REPO_ROOT}" worktree prune

# --- delete the local branch ----------------------------------------------
if git -C "${REPO_ROOT}" show-ref --verify --quiet "refs/heads/${BRANCH}"; then
  if [[ "${FORCE}" -eq 1 ]]; then
    git -C "${REPO_ROOT}" branch -D "${BRANCH}" >/dev/null
  else
    # `-d` refuses if the branch is unmerged into its upstream/HEAD; safe.
    git -C "${REPO_ROOT}" branch -d "${BRANCH}" >/dev/null
  fi
  echo "Deleted branch:   ${BRANCH}"
else
  echo "Branch '${BRANCH}' already absent — nothing to delete."
fi

echo "Cleanup complete for ${TASK_ID}."
