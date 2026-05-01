#!/usr/bin/env bash
# list_ready_tasks.sh — Print the orchestrator's "ready set", one task id per line.
#
# Usage:
#   scripts/list_ready_tasks.sh
#
# A task is "ready" when:
#   1. its `status:` in dependencies.yaml is `pending`
#   2. every entry in its `depends_on: [...]` list has been merged
#
# "Merged" detection is identical to cleanup_worktree.sh: we scan the most
# recent N commit subjects on main (default 200, override with
# BINDERLY_MERGE_LOG_DEPTH) for one beginning with `<dep-id>:`. This matches
# the orchestrator's actual squash-merge convention.
#
# Output format:
#   - One task id per line on stdout. No header, no trailing whitespace.
#   - Tasks listed in the order they appear in dependencies.yaml.
#   - Empty output is valid (and currently expected — the foundation tasks
#     in flight are `in_progress`, not `pending`, so nothing is "ready" until
#     they merge).
#   - All informational lines go to stderr so the stdout stream is safe to
#     pipe (`scripts/list_ready_tasks.sh | head -n MAX_PARALLEL`).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "${SCRIPT_DIR}" rev-parse --show-toplevel)"
CONFIG_FILE="${REPO_ROOT}/scripts/orchestrator.config.json"
DEPS_FILE="${REPO_ROOT}/dependencies.yaml"

if [[ ! -f "${CONFIG_FILE}" ]]; then
  echo "ERROR: config file not found: ${CONFIG_FILE}" >&2
  exit 66
fi
if [[ ! -f "${DEPS_FILE}" ]]; then
  echo "ERROR: dependencies file not found: ${DEPS_FILE}" >&2
  exit 66
fi

read_json_string() {
  local key="$1" file="$2"
  grep -oE "\"${key}\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" "${file}" \
    | sed -E "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\"([^\"]*)\".*/\1/" \
    | head -n1
}

MAIN_BRANCH="$(read_json_string default_main_branch "${CONFIG_FILE}")"
: "${MAIN_BRANCH:?missing default_main_branch in ${CONFIG_FILE}}"

if ! git -C "${REPO_ROOT}" show-ref --verify --quiet "refs/heads/${MAIN_BRANCH}"; then
  echo "ERROR: main branch '${MAIN_BRANCH}' not found locally" >&2
  exit 66
fi

# --- collect merged task ids from main's recent log -----------------------
LOG_DEPTH="${BINDERLY_MERGE_LOG_DEPTH:-200}"
# Extract the leading "T-XX-XXX" from each commit subject of the form
# "<task-id>: <message>". Stored newline-separated for cheap grep lookup.
MERGED_IDS="$(
  git -C "${REPO_ROOT}" log --format=%s "${MAIN_BRANCH}" -n "${LOG_DEPTH}" \
    | grep -oE '^T-[A-Z]{2}-[A-Z0-9-]+:' \
    | sed 's/:$//' \
    | sort -u || true
)"

is_merged() {
  # exact match against the deduped list
  printf '%s\n' "${MERGED_IDS}" | grep -qx "$1"
}

# --- parse dependencies.yaml ----------------------------------------------
# We only need three fields per task: id, status, depends_on. The YAML in
# this repo is rigidly formatted (one field per line, depends_on always
# inline-array), so a tiny awk state machine is sufficient — no yq/python.
parse_yaml() {
  awk '
    function emit() {
      if (id != "") {
        printf "%s|%s|%s\n", id, status, deps
      }
    }
    BEGIN { id=""; status=""; deps="" }
    /^[[:space:]]+- id: / {
      emit()
      id = $3; status = ""; deps = ""
    }
    /^[[:space:]]+status: / { status = $2 }
    /^[[:space:]]+depends_on: \[/ {
      line = $0
      sub(/^[^[]*\[/, "", line)   # strip everything up to and including [
      sub(/\].*$/, "", line)      # strip ] and anything after
      gsub(/[[:space:]]/, "", line)
      deps = line
    }
    END { emit() }
  ' "$1"
}

# --- compute ready set ----------------------------------------------------
while IFS='|' read -r id status deps; do
  [[ -z "${id}" ]] && continue
  [[ "${status}" == "pending" ]] || continue

  ready=1
  if [[ -n "${deps}" ]]; then
    IFS=',' read -ra dep_arr <<< "${deps}"
    for d in "${dep_arr[@]}"; do
      [[ -z "${d}" ]] && continue
      if ! is_merged "${d}"; then
        ready=0
        break
      fi
    done
  fi

  if [[ "${ready}" -eq 1 ]]; then
    printf '%s\n' "${id}"
  fi
done < <(parse_yaml "${DEPS_FILE}")
