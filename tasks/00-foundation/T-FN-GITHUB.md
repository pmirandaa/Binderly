# T-FN-GITHUB — GitHub repo, branch protection, PR template

**Stage:** 00-foundation
**Agent role:** devops
**Effort:** S
**Status:** pending

## Hard dependencies
- T-FN-MONOREPO

## Soft dependencies
- T-FN-TS-CONFIG, T-FN-LINT-CONFIG (parallel-safe)

## Required reading
- rules/00-foundation.md
- context/conventions.md (PRs section)

## Goal
Set up the GitHub repository's local-side artifacts: PR template, issue
templates, CODEOWNERS, branch protection (documented; the actual setting
requires Pablo to apply it via the GitHub UI or `gh` CLI on his account).

This task does NOT create the GitHub repo itself — that's a one-time human
action by Pablo. This task assumes the repo exists and `git remote add
origin` has been done.

## Deliverables

- `.github/pull_request_template.md` — sections: *What*, *Why*,
  *Acceptance*, *Notes*, *Out of scope*. Reference the agent task ID
  format.
- `.github/ISSUE_TEMPLATE/bug.yml` — minimal bug report.
- `.github/ISSUE_TEMPLATE/feature.yml` — minimal feature request.
- `.github/ISSUE_TEMPLATE/config.yml` — disable blank issues.
- `.github/CODEOWNERS` — `* @<pablo-username>` placeholder, with a
  comment instructing Pablo to swap in his GitHub handle.
- `docs/github-setup.md` — instructions for Pablo:
  - Create repo (if not done)
  - Apply branch protection on `main`: require PR, require status
    checks (CI lint/typecheck/test), require linear history, dismiss
    stale reviews
  - Set repository secrets (list from `context/secrets-and-env.md`)
  - Configure Vercel/Fly/Supabase/EAS GitHub integrations (deferred to
    deploy stage; mention here for context)

## Acceptance criteria

- [ ] PR template renders correctly when opening a PR (visible in
      preview).
- [ ] CODEOWNERS uses a placeholder clearly marked as such.
- [ ] `docs/github-setup.md` is actionable: every step has a precise
      click-path or `gh` command.
- [ ] No real secrets, tokens, or usernames committed.

## Out of scope

- Configuring the GitHub repo settings via API (requires GitHub auth Pablo
  hasn't given an agent).
- Workflows / CI YAML — T-FN-CI handles that.

## Branch & PR

- Branch: `agent/T-FN-GITHUB`
- PR title: `T-FN-GITHUB: GitHub repo scaffolding and setup docs`

## Escalation triggers

- GitHub repo doesn't exist or doesn't have a `main` branch.
- The CODEOWNERS placeholder pattern needs Pablo's actual handle to be
  meaningful.

## Notes from execution

**Executed:** 2026-04-30 by sub-agent on branch `agent/T-FN-GITHUB`.

**Deliverables shipped** (all under `owns_paths` = `.github/` plus the
explicitly-allowed `docs/github-setup.md`):

- `.github/pull_request_template.md` — `What` / `Why` / `Acceptance` /
  `Notes` / `Out of scope` sections. Title-line comment references the
  `T-XX-XXX: <title>` agent-PR format from `context/conventions.md` § PRs.
- `.github/ISSUE_TEMPLATE/bug.yml` — GitHub form schema, validated with
  `python3 -c "yaml.safe_load(...)"`.
- `.github/ISSUE_TEMPLATE/feature.yml` — form schema, validated.
- `.github/ISSUE_TEMPLATE/config.yml` — `blank_issues_enabled: false` plus
  a pointer to GitHub Security Advisories for vuln reports.
- `.github/CODEOWNERS` — `* @<pablo-username>` with a `# TODO: replace
  <pablo-username>` comment calling out that CODEOWNERS-enforced review
  under branch protection is a no-op until Pablo substitutes his real
  handle.
- `docs/github-setup.md` — step-by-step click-path + `gh` commands for
  default-branch swap, branch protection, squash-merge settings, secrets
  (mirroring `context/secrets-and-env.md`), variables for feature flags,
  Actions permissions, third-party integrations, and verification.

**Acceptance criteria** — all pass by inspection:

- PR template renders — sections present, comments guide usage (can't be
  tested offline without opening a PR; Pablo to confirm per §8 of the
  setup doc).
- CODEOWNERS placeholder clearly marked with `TODO` + explanation.
- Setup doc is actionable — every manual step has a URL click-path *and*
  a `gh` equivalent where the API supports it.
- No real secrets, tokens, usernames, or emails committed. Grep for
  common secret prefixes returned zero hits.

**Escalations / open issues:**

- CODEOWNERS still uses `<pablo-username>` placeholder. Branch-protection
  Code-Owner review enforcement is a no-op until Pablo replaces it (step
  1 of `docs/github-setup.md`). Flagged but not blocking.
- `gh pr create` skipped per dispatch instructions (Q-001 — gh auth
  broken). Orchestrator will open the PR from the printed URL.

**Dependencies unblocked:** T-FN-CI can now rely on the PR template and
(after Pablo applies branch protection) on the `lint` / `typecheck` /
`test` / `build` status-check names documented in `github-setup.md` §3.

**Commits:**
- `feat(github): add PR + issue templates, CODEOWNERS, setup docs`
- `docs(task): record T-FN-GITHUB execution notes`
