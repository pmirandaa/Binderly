# T-GR-COMMUNITY-FLYWHEEL — Community submission flywheel (paid users upload graded outcomes)

**Stage:** 07-grading
**Agent role:** backend
**Effort:** M
**Status:** in_progress

## Hard dependencies

- T-GR-AGGREGATE (merged) — closes the prediction pipeline this flywheel feeds.
- T-PB-ENTITLEMENTS (merged) — `@binderly/entitlements` `grading_prediction`
  PaidFeature + `canUseFeature`; the submission flow is pro-gated.

## Soft dependencies

- T-PB-GATING (racing) — ships `@binderly/feature-flags` + a mobile `useGate`
  hook. **Not merged when this task ran**, so the mobile gate uses the
  `@binderly/entitlements` fallback: `client.entitlements.getMyEntitlements()`
  → `canUseFeature(tier, 'grading_prediction')`. Swap to `useGate` at the
  T-PB-GATING merge (single call-site in `CommunitySubmissionScreen`).

## Required reading

- PROJECT.md § 12 (Grading Pipeline — "community submission flywheel"), § 16
  (grading prediction = pro).
- rules/07-grading.md ("Community flywheel is paid-only"; "training data
  hygiene"; "calibrate to PSA for v1, keep separate label streams").
- `apps/api-python/grading/ml_common/` — `LabelledGradingSample` (consumed
  read-only), `data_loader.py` (PSADataLoader reads `grading_training_sample`),
  `image_loader.py` (mock-by-default + live env gate).
- `apps/api-python/grading/scrapers/psa/{job,types}.py` — the write pattern
  the flywheel mirrors (`run_job` + `to_training_sample_row`, `source='psa_cert'`).
- `packages/db/src/schema/grading.ts` — `grading_training_sample` already
  permits `source='community_flywheel'` in its CHECK constraint.
- `apps/mobile/src/grading/capture/` — the 4-shot capture session the
  submission reuses; `apps/mobile/src/billing/` — `usePaidFeature` / tier.

## Goal

Ship the first-party data inflow that powers the long-term grading-accuracy
flywheel: a **pro-gated** flow for users to submit their real graded-card
outcomes (PSA/BGS/CGC/SGC slab cert + the photos they captured), normalised
into `LabelledGradingSample`-shaped rows in `grading_training_sample`
(`source='community_flywheel'`). Instead of scraping (iter 28), users
contribute their own labelled data. Closes Stage 07 (10/10).

## Deliverables

### Python ingestion — `apps/api-python/grading/flywheel/`
- `types.py` — `CommunitySubmission` (raw input) + `to_training_sample_row()`
  producing the exact `grading_training_sample` shape; `FlywheelJobResult` /
  `SubmissionConflict` mirroring PSA's `JobResult` / `DataConflict`.
- `validation.py` — per-company cert-number format (PSA/BGS/CGC/SGC), grade
  range, required-field, required-photo, and consent validation.
- `normalization.py` — cert-number normalization (canonical key) + conservative
  cross-company grade normalization (raw grade preserved; #FU-55 logged for
  proper cross-company calibration).
- `ingest.py` — `run_ingestion(submissions, *, db_upsert_fn, existing_source_ids_fn?, image_handler?)`
  → validate → normalize → dedup on `(source, source_id)` → upsert. Mock-by-
  default image handling (URL references only; `FLYWHEEL_LIVE_IMAGES` gate);
  full image ingest deferred to #FU-39.
- `tests/` — `test_validation.py`, `test_normalization.py`, `test_ingest.py`
  (40+ pytest, no live network/storage).

### DB — `packages/db/`
- `src/schema/community_submission.ts` — user-owned raw submission table.
- `src/migrations/0025_community_submission.sql` + `0026_community_submission_rls.sql`
  (owner-CRUD RLS; cross-schema FK to `auth.users`; service-role grant for the
  ingestion job). `_journal.json` updated.
- `scripts/verify-rls/inventory.ts` — `community_submission` added (owner CRUD).
- `grading_training_sample` is **reused** (already supports
  `source='community_flywheel'`); no change to it or `LabelledGradingSample`.

### Contracts / client — `packages/api-contracts/`, `packages/api-client/`
- `communitySubmission.ts` DTO (request/response/already-submitted).
- `communitySubmissions` resource (`POST /v1/me/community-submissions`).

### Mobile — `apps/mobile/src/grading/community/`
- `types.ts`, `validation.ts` (pure, mirrors Python rules), `submission-machine.ts`
  (idle/submitting/success/error/already-submitted), `community-service.ts`,
  `screens/CommunitySubmissionScreen.tsx` (pro-gated entry + consent note +
  form + states; reuses captured shots), `index.ts`, `__tests__/` (30+ vitest).

## Acceptance criteria

- [ ] Mobile pro-gated submission flow with validation + 5 states; 30+ vitest.
- [ ] Python ingestion → `grading_training_sample` (`source='community_flywheel'`)
      with cert dedup + grade normalization, mock-by-default; 40+ pytest.
- [ ] `community_submission` migration + owner-CRUD RLS + verify-rls inventory.
- [ ] lint + typecheck + build + mobile test + pytest (+ verify-rls) green.
- [ ] No changes outside `owns_paths` + the declared additive surfaces.

## Out of scope

- Full image ingest / R2 transcode of submitted photos (#FU-39 — store URL refs).
- Cross-company grade calibration as an ML decision (#FU-55 — conservative map).
- The `/v1/me/community-submissions` edge handler (#FU-56 — contract + client
  pinned; handler follows the existing mux pattern, like grading's resource
  which also precedes its handler).
- Modifying `LabelledGradingSample` or the sub-grade model dirs.

## Branch & PR

- Branch: `agent/T-GR-COMMUNITY-FLYWHEEL`
- PR title: `feat(grading): T-GR-COMMUNITY-FLYWHEEL — pro user graded-outcome submissions → labelled training data`
- Commit format: Conventional Commits

## Escalation triggers

Stop and surface to orchestrator if:
- Producing `community_flywheel` rows requires a schema change to
  `grading_training_sample` / `LabelledGradingSample` (grading-models-owned).
- Image storage genuinely can't be deferred.
- Cross-company grade calibration is a real product/ML decision.

## Notes from execution

_(appended at end)_
