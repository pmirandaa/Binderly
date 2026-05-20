# T-GR-CENTERING — Centering measurement (geometric, deterministic)

**Stage:** 07-grading
**Agent role:** ml
**Effort:** M (~half day)
**Status:** in_progress

## Hard dependencies

- T-GR-CAPTURE-UX (must be merged before this starts — provides `GradingCaptureSession`
  shape + the `frontFull`/`backFull` URI contract)

## Soft dependencies

- T-GR-CORNERS, T-GR-EDGES, T-GR-SURFACE (parallel siblings — share no `owns_paths`)

## Required reading

- `PROJECT.md` § 12 (Grading Pipeline — centering is one of four PSA sub-grades,
  deterministic/geometric, `50/50 → 10.0; standard PSA tolerances`)
- `rules/07-grading.md` (centering must be geometric, not ML; predictions are
  confidence bands; Laplacian-variance blur rejection)
- `tasks/07-grading/T-GR-CAPTURE-UX.md` (session shape, the `__getLastEmittedSession`
  placeholder seam tagged `@deprecated FU-T-GR-CENTERING-ROUTING`, #FU-32 reference)
- `apps/mobile/src/grading/capture/types.ts` (`GradingCaptureSession`, `GradingShot`)
- `apps/mobile/src/grading/capture/session.ts` (session id convention: `gcs-<ts>-<rand>`)
- `apps/api-python/embeddings/` (Python module conventions: `pyproject.toml`,
  `pytest`, `conftest.py`, synthetic fixture approach)

## Goal

Implement a **geometric, deterministic centering measurement** for Pokémon (and
standard-bordered TCG) cards. The algorithm ingests the `frontFull` + `backFull`
captures from `GradingCaptureSession`, detects the outer card edge and inner
coloured border using OpenCV, computes the four margin widths (top / bottom /
left / right), and maps the resulting left/right and top/bottom ratios to a
PSA centering grade hint (`10` / `9` / `8` / `7` / `worse`). The Python
implementation is the authoritative ground truth; the TypeScript mobile module
ships as a typed contract + session-store seam (the actual measurement runs
off-device for v1, routing to the Python service when it is deployed).

This task also **closes #FU-32** by replacing the `__getLastEmittedSession`
module-level variable with a proper session-store: a module-scoped `Map<string,
GradingCaptureSession>` keyed by session id, written by the capture screen and
read by the centering screen via an expo-router `?sessionId=` query param.

## Owns paths

- `apps/api-python/grading/centering/` — Python implementation (authoritative)
- `apps/mobile/src/grading/centering/` — TypeScript contract + session routing
- `apps/mobile/app/grading/centering.tsx` — expo-router route file (one new file
  outside `owns_paths`; justified as the same pattern T-SC-CAMERA / T-GR-CAPTURE-UX
  used for `app/(tabs)/scanner.tsx` and `app/grading/capture/review.tsx`)

## Deliverables

### Python (`apps/api-python/grading/centering/`)

- `__init__.py` — public barrel; exports `CenteringResult`, `measure_centering`.
- `types.py` — `CenteringResult` dataclass (margins, ratios, grade_hint, confidence,
  flags like `low_confidence_holographic`).
- `detector.py` — `detect_card_rect(image: np.ndarray) → CardRect | None`:
  Canny + morphology + `cv2.findContours` to find the largest near-rectangular
  contour (the outer card edge). Returns the bounding rectangle in pixel
  coordinates with rotation angle.
- `measure.py` — `measure_centering(front_path, back_path) → CenteringResult`:
  orchestrates `detect_card_rect` + inner-border detection via `cv2.HoughLinesP`,
  computes four margins, ratio pair (H/V), and grade hint.
- `grade.py` — `centering_grade_hint(h_ratio, v_ratio) → str`: pure lookup against
  the PSA tolerance table (10→55/45, 9→60/40, 8→65/35, 7→70/30, worse→below).
- `tests/conftest.py` — shared fixtures: `fixture_dir`, `synthetic_card` factory
  (draws a known-margin card on a known-background using Pillow; parameterised
  over offset, rotation, and card size).
- `tests/fixtures/build.py` — script to regenerate synthetic images.
- `tests/test_grade.py` — ≥ 8 tests covering the PSA table boundary values.
- `tests/test_detector.py` — ≥ 6 tests: centred card, off-centre, rotated (≤ 5°),
  small card, large card, empty image (returns None).
- `tests/test_measure.py` — ≥ 8 tests: known-margin cards (asserts ratio within
  tolerance), both-face measurement, back-absent fallback, holographic flag.
- `tests/test_types.py` — 2 tests: dataclass round-trip, grade_hint propagation.

### TypeScript (`apps/mobile/src/grading/centering/`)

- `types.ts` — `CenteringRequest`, `CenteringResult`, `CenteringGradeHint`,
  `CenteringServiceError` + typed session-store contract.
- `session-store.ts` — module-scoped `Map<string, GradingCaptureSession>`;
  `storeSession(session)`, `getSession(id)`, `clearSession(id)`. Replaces
  `__getLastEmittedSession`. Future grading siblings (T-GR-CORNERS, T-GR-EDGES,
  T-GR-SURFACE) hang their own routing off the same session id key.
- `centering-service.ts` — `CenteringService` interface + factory
  `createCenteringService(impl?)`. Default impl for v1: calls back with a
  `not_implemented` error and `low_confidence` flag so the UI degrades gracefully
  until the Python service endpoint is wired. A future task replaces the impl.
- `use-centering.ts` — React hook `useCentering(sessionId)` that reads the
  session from the store, invokes the service, and returns
  `{ status, result, error }`.
- `screens/CenteringScreen.tsx` — The real centering screen. Reads `sessionId`
  from `useLocalSearchParams`, retrieves the session from the store, shows a
  loading/result/error state. Replaces the placeholder `GradingCaptureReviewScreen`
  at `/grading/centering`.
- `index.ts` — public barrel.
- `__tests__/session-store.test.ts` — tests for the session-store CRUD.
- `__tests__/centering-service.test.ts` — contract tests for the service factory.
- `__tests__/use-centering.test.tsx` — hook tests with injected impl.
- `__tests__/CenteringScreen.test.tsx` — screen rendering tests with mocked service.

### Route file changes

- `apps/mobile/app/grading/centering.tsx` — new expo-router route; one-line
  re-export of `CenteringScreen`. The capture review screen now pushes here
  (`router.push('/grading/centering?sessionId=<id>')`) instead of storing the
  session in a global.
- `apps/mobile/app/grading/capture/review.tsx` — updated: the Continue button's
  route target changes from `/grading/centering` (stub) to a proper
  `/grading/centering?sessionId=${session.id}` push, **and** the `GradingCaptureScreen`
  capture-complete effect now calls `storeSession(emitted)` then routes with the
  session id instead of `__setLastEmittedSession`. Both files are in T-GR-CAPTURE-UX's
  `owns_paths` (`apps/mobile/src/grading/capture/`) except the route file, which
  we update as a justified cross-path touch (same pattern as T-GR-CAPTURE-UX adding
  `app/grading/capture/review.tsx`).

## Acceptance criteria

- [ ] **Python:** `cd apps/api-python && pytest grading/centering/tests/ -q` passes
      with ≥ 20 tests, ≥ 6 detector tests, ≥ 8 grade tests, ≥ 8 measure tests,
      ≥ 2 type tests. Zero failures.
- [ ] **Python:** A synthetic card with known margins (e.g. left=40px, right=60px →
      40/60 ratio) produces a `CenteringResult` with `h_ratio` within `±2%` of the
      true ratio and `grade_hint == '9'` (60/40 tolerance).
- [ ] **Python:** A centred card (50/50 margins) returns `grade_hint == '10'`.
- [ ] **Python:** An image with no detectable card returns `None` from
      `detect_card_rect` and a `low_confidence` result from `measure_centering`.
- [ ] **Python:** A card with rotation ≤ 5° still detects the outer rect and
      produces a ratio within `±5%` of the true value.
- [ ] **Python:** The holographic-flag code path is exercised by at least one test
      (e.g. very low inner-border detection confidence → `low_confidence_holographic`).
- [ ] **TypeScript:** `session-store` CRUD: `storeSession → getSession` returns
      the same object reference; `clearSession` removes it; getting an unknown id
      returns `undefined`.
- [ ] **TypeScript:** `useCentering` with a missing session id returns
      `{ status: 'error', error: 'session_not_found' }` without calling the service.
- [ ] **TypeScript:** `useCentering` with a valid session calls the injected impl
      with `{ frontUri, backUri }` derived from the session.
- [ ] **TypeScript:** `CenteringScreen` renders an error state when the service
      returns a `not_implemented` error.
- [ ] **TypeScript:** `CenteringScreen` renders a loading state while the service
      is in-flight.
- [ ] **TypeScript:** The capture screen's `__setLastEmittedSession` is replaced by
      `storeSession`, and `GradingCaptureScreen` routes to
      `/grading/centering?sessionId=<id>` instead of `CAPTURE_REVIEW_ROUTE`.
      The old `__getLastEmittedSession` / `__setLastEmittedSession` exports remain
      in the barrel (marked `@deprecated`) for one release cycle so no external
      caller breaks.
- [ ] **TypeScript:** All new mobile tests pass under
      `pnpm --filter @binderly/mobile test`.
- [ ] **TypeScript:** `pnpm --filter @binderly/mobile lint typecheck` passes with
      0 errors / 0 warnings.
- [ ] No new top-level monorepo dependencies.
- [ ] No changes outside `owns_paths` except the two justified route-file touches
      described above (documented in PR body).

## PSA centering tolerance table (source of truth for `grade.py`)

Standard PSA centering measurement: margin ratio reported as
`min(a, b) / max(a, b) × 100` per axis. Grade requires **both** axes to meet:

| PSA grade hint | H tolerance | V tolerance |
|:--------------:|:-----------:|:-----------:|
| 10             | 55/45       | 55/45       |
| 9              | 60/40       | 60/40       |
| 8              | 65/35       | 65/35       |
| 7              | 70/30       | 70/30       |
| worse          | below 70/30 | —           |

Tolerance is inclusive: a 60/40 ratio qualifies for PSA 9 (and PSA 10 if the
other axis also qualifies). Ratio expressed as the smaller fraction: 55/45 →
`min/max = 0.818`. A perfectly centred card is 50/50 → 1.0.

Citation: PSA grading standards (https://www.psacard.com/resources/gradingstandards)
— no explicit table published; the values above are the community-documented
consensus used by graders and are referenced in the T-GR-CENTERING brief pending
any official PSA publication.

## Session-routing strategy (#FU-32 closure)

**Problem:** T-GR-CAPTURE-UX shipped a module-scoped `lastEmittedSession` variable
(`__setLastEmittedSession` / `__getLastEmittedSession`) as a placeholder hand-off
to the next screen. The 4 photo URIs are too large for URL query params (they are
file:/// paths, not base64 blobs), so we cannot encode the full session in the URL.

**Solution:**
1. A **module-scoped `Map<string, GradingCaptureSession>`** in
   `apps/mobile/src/grading/centering/session-store.ts` acts as an in-process
   registry, keyed by `session.id` (the `gcs-<ts>-<rand>` string already generated
   by T-GR-CAPTURE-UX's `createInitialSessionState`).
2. When the capture screen completes, it calls `storeSession(emitted)` and pushes
   `/grading/centering?sessionId=${emitted.id}` via `router.push`.
3. The centering screen reads `sessionId` from `useLocalSearchParams()` and calls
   `getSession(sessionId)` to retrieve the full session object.
4. After the centering screen unmounts (or when routing away), `clearSession` is
   called to free memory.

**Why not AsyncStorage / URL base64?** The session is ephemeral (single app-open);
persisting to AsyncStorage adds unnecessary complexity for v1. URL-encoding 4 file
URIs is possible but brittle (path characters, 2KB+ URL limit on some Android
versions). The Map approach is the simplest correct solution.

**Future sibling tasks** (T-GR-CORNERS, T-GR-EDGES, T-GR-SURFACE) route to their
own screens with the same `?sessionId=` pattern, reading from the same store. The
store module is the single seam — future workers import `getSession` from the
centering barrel.

## Design trade-off: on-device vs. off-device algorithm (TypeScript v1 posture)

OpenCV is a native module with no pure-JS equivalent that matches its accuracy on
real card photos. The mobile-side TypeScript module ships as a **typed contract +
factory pattern** for v1:
- The `CenteringService` interface is the contract.
- The default impl returns `{ status: 'not_implemented' }` + `low_confidence` flag.
- A future task replaces the default impl with a network call to the Python service
  once the API endpoint is deployed.

The Python module is authoritative and ships a full implementation. This trade-off
is deliberate and documented here: requiring OpenCV on-device would add ~30 MB to
the mobile binary and require native build changes outside this task's scope.

An alternative — porting the algorithm to pure JS using typed arrays — is feasible
for the contour detection step (T-SC-DETECT shipped a gradient-projection rect
finder in pure JS) but the accuracy on real card photos (especially holographic
borders) is unknown. Tracked as follow-up **#FU-33**.

## Out of scope

- Actual network call to the Python grading service (pending API deployment task).
- Pure-JS on-device centering algorithm (tracked as #FU-33).
- Saving centering results to the `grading_submission` DB row (write-back lands
  with the aggregate task T-GR-AGGREGATE).
- The remaining two corner crops (bottom-left, bottom-right) and the surface
  raking-light shot from PROJECT.md § 12 (tracked as `FU-T-GR-CAPTURE-FULL-SCHEMA`).
- Back-face centering ML fallback for listings with only a front photo.
- Holographic / full-art / textured border detection beyond the `low_confidence`
  flag.

## Branch & PR

- Branch: `agent/T-GR-CENTERING`
- PR title: `feat(grading): T-GR-CENTERING — geometric centering measurement`
- Commit format: Conventional Commits

## Escalation triggers

Stop and surface to orchestrator if:

- A product decision is required on the centering grade mapping (e.g. should we
  expose a numeric 0.0–10.0 subgrade instead of a hint string?).
- The `GradingCaptureSession` shape in T-GR-CAPTURE-UX's merged code diverges
  from the types documented here.
- A change is needed outside the two documented justified cross-path touches.
- CI cannot be made green within the constraints of this task's owns_paths.

## Notes from execution

(Sub-agent appends here at end.)
