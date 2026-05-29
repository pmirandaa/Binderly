#!/usr/bin/env bash
# spawn_worktree.sh — Create a git worktree + branch for a sub-agent task.
#
# Usage:
#   scripts/spawn_worktree.sh <task-id>
#
# Behaviour:
#   - Validates <task-id> against the canonical regex ^T-[A-Z]+-[A-Z0-9-]+$.
#   - Confirms the task id appears in dependencies.yaml as a list item
#     ("  - id: <task-id>") so we never spawn a worktree for a typo.
#   - Reads scripts/orchestrator.config.json for branch_prefix,
#     worktree_prefix, and default_main_branch.
#   - Refuses (loud, non-zero exit) if the worktree path already exists on
#     disk, the path is already registered with git, or the branch already
#     exists locally. Idempotent: no half-created state on re-run.
#   - Creates the branch off main and adds the worktree in one
#     `git worktree add -b` call.
#   - Prints the absolute worktree path on success so the orchestrator can
#     paste it into a new Cursor window.
#
# Exit codes (sysexits.h-flavoured):
#   64  bad usage (missing/extra args)
#   65  bad data  (regex / id not in dependencies.yaml)
#   66  no input  (config or deps file missing)
#   73  can't create (path/branch already exists)

set -euo pipefail

# --- locate repo root + config files --------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# rev-parse --show-toplevel resolves the *current worktree's* root, which is
# what we want — the orchestrator runs this from main but a sub-agent could
# also call it from inside its own worktree to spawn a peer task.
REPO_ROOT="$(git -C "${SCRIPT_DIR}" rev-parse --show-toplevel)"
CONFIG_FILE="${REPO_ROOT}/scripts/orchestrator.config.json"
DEPS_FILE="${REPO_ROOT}/dependencies.yaml"

# --- usage ----------------------------------------------------------------
usage() {
  cat >&2 <<EOF
Usage: $(basename "$0") <task-id>
Example: $(basename "$0") T-DL-SCHEMA-CARDS

Creates branch agent/<task-id> off main and a sibling worktree at
../binderly-wt-<task-id>. Idempotent: refuses if either already exists.
EOF
  exit 64
}

[[ $# -eq 1 ]] || usage
TASK_ID="$1"

# --- validate task id format ----------------------------------------------
# Pattern matches T-<one-or-more uppercase letters>-<one-or-more uppercase
# letters, digits, or dashes>. The scope segment allows single-letter
# scopes like `T-M-SHELL` / `T-W-SHELL` (see #FU-10).
TASK_ID_REGEX='^T-[A-Z]+-[A-Z0-9-]+$'
if [[ ! "${TASK_ID}" =~ ${TASK_ID_REGEX} ]]; then
  echo "ERROR: task id '${TASK_ID}' does not match ${TASK_ID_REGEX}" >&2
  exit 65
fi

# --- input files ----------------------------------------------------------
if [[ ! -f "${CONFIG_FILE}" ]]; then
  echo "ERROR: config file not found: ${CONFIG_FILE}" >&2
  exit 66
fi
if [[ ! -f "${DEPS_FILE}" ]]; then
  echo "ERROR: dependencies file not found: ${DEPS_FILE}" >&2
  exit 66
fi

# --- validate task exists in dependencies.yaml ----------------------------
# YAML uses "  - id: T-XX-XXX" for each task list-item under tasks:.
# A bare grep against that pattern is exactly what the task spec calls for.
if ! grep -E "^[[:space:]]+- id: ${TASK_ID}$" "${DEPS_FILE}" >/dev/null; then
  echo "ERROR: task '${TASK_ID}' not declared in ${DEPS_FILE}" >&2
  echo "Hint: only the orchestrator may add tasks to dependencies.yaml." >&2
  exit 65
fi

# --- read JSON config (no jq dep) -----------------------------------------
# Tiny ad-hoc string-value reader. Only handles "key": "value" pairs, which
# is all orchestrator.config.json needs. Refuse if a required key is empty.
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

# Worktree paths are configured relative to REPO_ROOT (e.g. "../binderly-wt-").
# Resolve to an absolute path by cd'ing through the parent dir.
WORKTREE_REL="${WORKTREE_PREFIX}${TASK_ID}"
WORKTREE_PARENT_REL="$(dirname "${WORKTREE_REL}")"
WORKTREE_BASENAME="$(basename "${WORKTREE_REL}")"
WORKTREE_PARENT_ABS="$(cd "${REPO_ROOT}" && cd "${WORKTREE_PARENT_REL}" && pwd)"
WORKTREE_ABS="${WORKTREE_PARENT_ABS}/${WORKTREE_BASENAME}"

# --- idempotent failure: refuse if anything already exists ----------------
if [[ -e "${WORKTREE_ABS}" ]]; then
  echo "ERROR: worktree path already exists on disk: ${WORKTREE_ABS}" >&2
  echo "Hint: run scripts/cleanup_worktree.sh ${TASK_ID} [--force] first." >&2
  exit 73
fi
# Also catch the case where the path was rm-rf'd manually but git still
# remembers it (stale entry in .git/worktrees/<name>).
if git -C "${REPO_ROOT}" worktree list --porcelain \
    | grep -qE "^worktree ${WORKTREE_ABS}$"; then
  echo "ERROR: worktree '${WORKTREE_ABS}' already registered with git" >&2
  echo "Hint: run scripts/cleanup_worktree.sh ${TASK_ID} [--force] first." >&2
  exit 73
fi
if git -C "${REPO_ROOT}" show-ref --verify --quiet "refs/heads/${BRANCH}"; then
  echo "ERROR: branch '${BRANCH}' already exists locally" >&2
  echo "Hint: run scripts/cleanup_worktree.sh ${TASK_ID} [--force] first." >&2
  exit 73
fi

# --- ensure main exists ---------------------------------------------------
if ! git -C "${REPO_ROOT}" show-ref --verify --quiet "refs/heads/${MAIN_BRANCH}"; then
  echo "ERROR: main branch '${MAIN_BRANCH}' not found locally" >&2
  echo "Hint: git fetch origin ${MAIN_BRANCH}:${MAIN_BRANCH}" >&2
  exit 66
fi

# --- create branch + worktree in one shot ---------------------------------
# `git worktree add -b BRANCH PATH START` creates BRANCH at START and checks
# it out into PATH. Atomic from our perspective: either both succeed or git
# rolls back its own state.
git -C "${REPO_ROOT}" worktree add -b "${BRANCH}" "${WORKTREE_ABS}" "${MAIN_BRANCH}" >/dev/null

cat <<EOF
Spawned worktree:
  task     : ${TASK_ID}
  branch   : ${BRANCH}
  worktree : ${WORKTREE_ABS}

Open a new Cursor window at: ${WORKTREE_ABS}
EOF
