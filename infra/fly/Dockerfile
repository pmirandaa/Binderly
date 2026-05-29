# Container image for the Binderly Python service (apps/api-python) on Fly.io.
#
# Build context is the REPO ROOT (so the apps/api-python tree is visible):
#   docker build -f infra/fly/Dockerfile -t binderly-api .
# flyctl uses the build context configured by the deploy invocation; the
# deploy-fly workflow runs `flyctl deploy --config infra/fly/fly.toml` from
# the repo root so this Dockerfile resolves `apps/api-python/` correctly.
#
# We install ONLY the runtime dependencies declared in pyproject.toml — NOT
# the `build` (TensorFlow ~500 MB) or `ml` (torch ~2 GB) optional extras,
# which are offline-training-only. The serving runtime needs ai-edge-litert,
# numpy, Pillow, pydantic, opencv-headless, httpx, beautifulsoup4, lxml.

FROM python:3.12-slim AS base

# - PYTHONUNBUFFERED: stream logs straight to Fly's log drain.
# - PIP_NO_CACHE_DIR / PIP_DISABLE_PIP_VERSION_CHECK: smaller, quieter builds.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Runtime system libs. opencv-python-headless needs libGL + glib even in its
# headless variant; the rest is curl for an in-container healthcheck probe.
# hadolint ignore=DL3008
RUN apt-get update \
    && apt-get install --no-install-recommends -y \
        libgl1 \
        libglib2.0-0 \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Copy only the Python package tree, then install it. The package metadata
# (pyproject.toml) drives the dependency resolution; `pip install .` builds a
# wheel and installs runtime deps without the dev/build/ml extras.
COPY apps/api-python/ /app/

RUN python -m pip install --upgrade pip \
    && pip install .

# Run as a non-root user (defence in depth; Fly best practice).
RUN useradd --create-home --uid 10001 appuser \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8080

# ASGI entrypoint. `binderly_api.main:app` is the FastAPI app the Q-021
# follow-up adds (alongside `fastapi` + `uvicorn` in pyproject deps). Until
# then the image builds but has no server to bind :8080 — the Fly deploy
# stays inert behind FLY_API_TOKEN regardless. uvicorn reads $PORT (set to
# 8080 in fly.toml [env]).
CMD ["sh", "-c", "uvicorn binderly_api.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
