# Stage 00 — Foundation rules

This stage establishes the monorepo, tooling, GitHub, CI, and local Docker.
Nothing here ships to users. Everything here makes the rest of the build
faster and safer.

## Required reading for every task in this stage

- `PROJECT.md` § 3 (Tech Stack), § 4 (Infra)
- `context/tech-stack.md`
- `context/conventions.md`
- `context/secrets-and-env.md`

## Hard rules

- **Pin every version.** No `^`, no `~`, no `latest`. Specifies exact
  patches in `package.json`, `pnpm-lock.yaml`, `.nvmrc`, Dockerfiles, GH
  Action `uses:` lines.
- **No application code.** Foundation tasks set up scaffolding only. If a
  foundation task touches an `apps/` or `packages/<feature>` directory
  beyond the scaffold, push back to the orchestrator — it's the wrong
  stage.
- **Local-first.** A clone-then-`pnpm i && pnpm dev` flow must work with
  zero cloud accounts after this stage merges. If a task can't satisfy
  this, raise it.
- **Idempotent setup.** Every `scripts/*` shell script can be re-run
  without breaking. No "did you already run X?" prompts.
- **Lint and typecheck pass on empty workspaces.** Each scaffolded package
  has at least an `index.ts` with `export {}` and passes `tsc --noEmit`
  and `eslint`.
- **Worktree-friendly.** Nothing relies on absolute paths inside the
  repo. All paths relative.

## Conventions specific to this stage

- Shell scripts are bash, `set -euo pipefail` at top, comments explain
  every non-obvious step.
- GitHub Action YAML uses workflow_dispatch + push triggers as defaults;
  never use `pull_request_target` (security footgun).
- Dockerfiles use multi-stage when relevant; pin base images by digest in
  CI builds.

## Common pitfalls

- pnpm workspaces + Turborepo can fight if `package.json` has a `workspaces`
  field at the root *and* `pnpm-workspace.yaml` exists. Use only
  `pnpm-workspace.yaml`.
- Supabase CLI's local stack and `docker-compose.yml` can both want port
  54321. Pin Supabase's port and document.
- Apple Silicon vs Intel base images for Docker — always specify
  `platform: linux/amd64` or use multi-arch images that exist for both.
- Ignoring `.env*` in `.gitignore` — but not `.env.example`.

## Done when

- `pnpm dev` starts web, mobile (web preview), and the Python service
  with no errors.
- `pnpm test`, `pnpm lint`, `pnpm typecheck` all pass on empty workspaces.
- A new contributor (or sub-agent) can run `git clone && pnpm i && pnpm
  dev` and have everything come up.
- GitHub repo exists, branch protection on `main`, agent PRs require CI
  green.
- Worktree spawn/cleanup scripts work end-to-end on a sample task.
