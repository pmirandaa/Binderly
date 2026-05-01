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
_(empty)_
