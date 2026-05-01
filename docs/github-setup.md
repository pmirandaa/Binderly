# GitHub repo setup — one-time manual steps

Artifacts inside this repo (PR template, issue templates, CODEOWNERS) are
already in place under `.github/`. This document covers the one-time setup
Pablo must do on **github.com** (or via `gh`) because the agent does not have
GitHub auth.

Work through the sections in order. Each step has either a click-path or a
`gh` command. All `gh` commands assume `gh auth login` has been completed.

---

## 0. Prerequisites

- You own the repo at `git@github.com:pmirandaa/Binderly.git`.
- The repo already has `main` on origin (pushed by the orchestrator during
  T-FN-MONOREPO). If `main` does not exist on origin yet, run:

  ```bash
  git push -u origin main
  ```

- `gh auth status` shows you logged in as the account that owns the repo. If
  it doesn't, run `gh auth login` and pick HTTPS + your personal account. See
  `open-questions.md` Q-001 for context on the current auth state.

---

## 1. Replace the CODEOWNERS placeholder

The file `.github/CODEOWNERS` currently contains `* @<pablo-username>`. Branch
protection's "Require review from Code Owners" rule will be a no-op until the
placeholder is replaced with your real GitHub login.

1. Find your login: visit https://github.com/settings/profile and copy the
   "Username" field (this may differ from the org name `pmirandaa`).
2. Edit `.github/CODEOWNERS` and replace `<pablo-username>` with that handle.
3. Commit + PR normally (Conventional Commits: `chore(github): set CODEOWNERS to real handle`).

---

## 2. Make `main` the default branch, delete `master`

The orchestrator uses `main`. If the GitHub UI still shows `master` as the
default, swap it now.

Via UI:

1. Go to https://github.com/pmirandaa/Binderly/settings/branches
2. Under "Default branch", click the pencil/swap icon next to the current
   default. Select `main`. Confirm "I understand, update the default branch".
3. Go to https://github.com/pmirandaa/Binderly/branches and click the trash
   icon next to `master` to delete it.

Via `gh`:

```bash
gh repo edit pmirandaa/Binderly --default-branch main
git push origin --delete master
```

If `master` was never pushed to origin, the second command is a no-op — skip
it.

---

## 3. Branch protection on `main`

Apply protection so agent PRs cannot merge without CI and review.

Via UI — https://github.com/pmirandaa/Binderly/settings/branches → "Add branch ruleset" (or the older "Add classic branch protection rule"). Target: `main`.

Enable:

- **Require a pull request before merging**
  - Required approvals: **1**
  - **Dismiss stale pull request approvals when new commits are pushed**: on
  - **Require review from Code Owners**: on (effective only after step 1)
- **Require status checks to pass before merging**
  - **Require branches to be up to date before merging**: on
  - Required checks (add them after T-FN-CI lands and has run at least once
    so they appear in the search box):
    - `lint`
    - `typecheck`
    - `test`
    - `build`
- **Require linear history**: on (matches "squash merges only" convention).
- **Require conversation resolution before merging**: on.
- **Do not allow bypassing the above settings**: on.
- **Restrict who can push to matching branches**: on — include only your
  account.

Via `gh` (classic protection API, one command):

```bash
gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  /repos/pmirandaa/Binderly/branches/main/protection \
  -f required_status_checks.strict=true \
  -F required_status_checks.contexts='["lint","typecheck","test","build"]' \
  -f enforce_admins=true \
  -F required_pull_request_reviews.required_approving_review_count=1 \
  -F required_pull_request_reviews.dismiss_stale_reviews=true \
  -F required_pull_request_reviews.require_code_owner_reviews=true \
  -F required_linear_history=true \
  -F allow_force_pushes=false \
  -F allow_deletions=false \
  -F required_conversation_resolution=true \
  -F restrictions=null
```

Tweak `contexts` once T-FN-CI finalizes the exact job names.

Squash-merge only:

1. https://github.com/pmirandaa/Binderly/settings → "Pull Requests"
2. Enable **Allow squash merging**; disable **Allow merge commits** and
   **Allow rebase merging**.
3. Enable **Automatically delete head branches**.

Via `gh`:

```bash
gh repo edit pmirandaa/Binderly \
  --allow-squash-merge \
  --allow-merge-commit=false \
  --allow-rebase-merge=false \
  --delete-branch-on-merge
```

---

## 4. Repository secrets

Set these in **Settings → Secrets and variables → Actions → New repository
secret**. The canonical list lives in `context/secrets-and-env.md`; the names
below mirror it. Values come from the platforms noted in that file — never
paste values into this doc, issues, PRs, or commit messages.

### CI / Actions (required for deploy workflows from T-FN-CI onward)

- `CI_VERCEL_TOKEN`
- `CI_FLY_API_TOKEN`
- `CI_EXPO_TOKEN`
- `CI_SUPABASE_ACCESS_TOKEN`
- `CI_SUPABASE_DB_PASSWORD`
- `CI_SUPABASE_PROJECT_REF`

### Web (only mirror into Actions if a workflow needs them; Vercel usually holds its own copies)

- `WEB_SUPABASE_URL`
- `WEB_SUPABASE_ANON_KEY`
- `WEB_R2_PUBLIC_BASE_URL`
- `WEB_POSTHOG_KEY`
- `WEB_SENTRY_DSN`
- `WEB_PADDLE_CLIENT_TOKEN`
- `WEB_PADDLE_API_KEY`
- `WEB_PADDLE_WEBHOOK_SECRET`
- `WEB_PADDLE_ENVIRONMENT`
- `WEB_TCGPLAYER_AFFILIATE_ID`

### Mobile (EAS will mostly hold these; mirror into Actions only if mobile CI needs them)

- `MOBILE_SUPABASE_URL`
- `MOBILE_SUPABASE_ANON_KEY`
- `MOBILE_R2_PUBLIC_BASE_URL`
- `MOBILE_POSTHOG_KEY`
- `MOBILE_SENTRY_DSN`
- `MOBILE_REVENUECAT_API_KEY_IOS`
- `MOBILE_REVENUECAT_API_KEY_ANDROID`
- `MOBILE_TCGPLAYER_AFFILIATE_ID`

### Python services (Fly holds the authoritative copies)

- `API_PYTHON_DB_URL`
- `API_PYTHON_R2_ACCESS_KEY_ID`
- `API_PYTHON_R2_SECRET_ACCESS_KEY`
- `API_PYTHON_R2_BUCKET_IMAGES`
- `API_PYTHON_R2_BUCKET_MODELS`
- `API_PYTHON_R2_BUCKET_ANN`
- `API_PYTHON_SENTRY_DSN`
- `API_PYTHON_PRICING_AGGREGATOR_PROVIDER`
- `API_PYTHON_PRICING_AGGREGATOR_API_KEY`
- `API_PYTHON_PRICING_AGGREGATOR_BASE_URL`
- `API_PYTHON_EBAY_BROWSE_APP_ID`
- `API_PYTHON_EBAY_BROWSE_CERT_ID`
- `API_PYTHON_EBAY_BROWSE_DEV_ID`
- `API_PYTHON_EBAY_MARKETPLACE_INSIGHTS_ENABLED`
- `API_PYTHON_FX_PROVIDER`
- `API_PYTHON_FX_API_KEY`
- `API_PYTHON_PSA_USER_AGENT`
- `API_PYTHON_EBAY_APP_ID`
- `API_PYTHON_EBAY_CERT_ID`
- `API_PYTHON_EBAY_DEV_ID`

### Edge Functions (Supabase, not Actions — documented for completeness)

- `EDGE_REVENUECAT_WEBHOOK_SECRET`
- `EDGE_PADDLE_WEBHOOK_SECRET`
- `EDGE_SUPABASE_SERVICE_ROLE_KEY` is provided automatically by Supabase.

### Feature flags (set as **Variables**, not secrets)

Settings → Secrets and variables → Actions → **Variables** tab:

- `PRICING_ENABLED` = `false`
- `CLOUD_FALLBACK_RECOGNITION` = `false`
- `COMMUNITY_GRADING_FLYWHEEL` = `false`

Bulk-add via `gh`:

```bash
# Secrets — prompts for each value, nothing is logged
for name in CI_VERCEL_TOKEN CI_FLY_API_TOKEN CI_EXPO_TOKEN \
            CI_SUPABASE_ACCESS_TOKEN CI_SUPABASE_DB_PASSWORD \
            CI_SUPABASE_PROJECT_REF; do
  gh secret set "$name" --repo pmirandaa/Binderly
done

# Variables
gh variable set PRICING_ENABLED --repo pmirandaa/Binderly --body "false"
gh variable set CLOUD_FALLBACK_RECOGNITION --repo pmirandaa/Binderly --body "false"
gh variable set COMMUNITY_GRADING_FLYWHEEL --repo pmirandaa/Binderly --body "false"
```

Repeat the loop for the other categories when you actually need them in CI.
Most app-scoped secrets live on Vercel / Fly / EAS / Supabase — only mirror
into Actions when a workflow needs them directly.

---

## 5. Actions permissions

Settings → Actions → General:

- **Actions permissions**: "Allow all actions and reusable workflows" (or
  restrict to the specific allowlist T-FN-CI publishes; tighten later).
- **Workflow permissions**: **Read repository contents and packages
  permissions** (least privilege). Individual workflows can elevate
  per-job with an explicit `permissions:` block.
- Uncheck **Allow GitHub Actions to create and approve pull requests**
  unless a specific workflow requires it.

Fork PRs: Settings → Actions → General → "Fork pull request workflows from
outside collaborators" → **Require approval for all outside collaborators**.

---

## 6. Third-party integrations (install now, wire up later)

These are referenced here for context — the actual wiring lands in the
deploy stage (T-DP-*). Install the GitHub Apps now so tokens are ready:

- **Vercel** — install the Vercel GitHub App, connect `pmirandaa/Binderly`,
  import `apps/web` as a project. Set web-scoped env vars inside Vercel
  (they override Actions-side copies).
- **Fly.io** — no GitHub App needed; deploys run via `flyctl deploy` inside
  Actions using `CI_FLY_API_TOKEN`.
- **Supabase** — link the project via `supabase link --project-ref $CI_SUPABASE_PROJECT_REF`
  locally; migrations are applied from CI using `CI_SUPABASE_ACCESS_TOKEN`.
- **Expo / EAS** — install the Expo GitHub App (for EAS Submit and preview
  builds). `CI_EXPO_TOKEN` covers the CLI path.
- **Sentry** (optional) — install the Sentry GitHub App for release /
  deploy tracking.

---

## 7. Misc polish

- https://github.com/pmirandaa/Binderly/settings → "Features": turn off
  Wikis (unused), keep Issues on, keep Projects if you plan to use a
  project board, Discussions off for now.
- Settings → "Pull Requests" → enable **Always suggest updating pull
  request branches**.
- Settings → Security → **Dependabot alerts** + **Dependabot security
  updates**: on. **Code scanning (CodeQL default setup)**: on. **Secret
  scanning** and **Push protection**: on.

---

## 8. Verify

- Open a draft PR from any branch and confirm the PR body pre-fills with
  the five sections from `.github/pull_request_template.md`.
- Open **New issue** and confirm you see "Bug report" and "Feature
  request" options and no blank-issue option.
- Try pushing directly to `main` from a test clone — it should be
  rejected by branch protection.
