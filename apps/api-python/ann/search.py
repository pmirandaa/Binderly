"""Reference brute-force search.

The Python search helpers exist for two reasons:

1. They are the recall@K benchmark target — the FP16 mobile pipeline
   is compared against the FP32 brute-force ground truth produced
   here.
2. They give the test suite a single source of truth for top-K
   ordering semantics (descending by score; ties broken by id
   ascending). The TypeScript searcher mirrors this contract.

These helpers are NOT the on-device runtime; the actual search
happens entirely in TypeScript on the phone.
"""

from __future__ import annotations

import numpy as np


def flat_topk(
    query: np.ndarray,
    embeddings: np.ndarray,
    ids: list[str],
    k: int,
) -> list[tuple[str, float]]:
    """Brute-force top-K cosine-similarity search.

    ``query`` is a 1-D float vector; ``embeddings`` is a 2-D
    ``(count, dim)`` float matrix. Both inputs are assumed L2-
    normalised (the upstream ``build_card_embeddings.py`` guarantees
    this), so ``cosine ≡ dot product``.

    The function pads or truncates so the returned list always has
    ``min(k, len(ids))`` rows. Ties are broken by id ascending — this
    matches the deterministic ordering the on-device loader emits so
    the cross-runtime tests can assert exact equality.
    """

    if query.ndim != 1:
        raise ValueError(f"query must be 1-D, got shape {query.shape!r}")
    if embeddings.ndim != 2:
        raise ValueError(
            f"embeddings must be 2-D, got shape {embeddings.shape!r}"
        )
    count, dim = embeddings.shape
    if query.shape[0] != dim:
        raise ValueError(
            f"query dim {query.shape[0]} disagrees with embeddings dim {dim}"
        )
    if len(ids) != count:
        raise ValueError(
            f"ids length {len(ids)} disagrees with embeddings count {count}"
        )
    if k <= 0:
        return []

    if count == 0:
        return []

    # Both query and embeddings are assumed L2-normalised; cosine ==
    # dot. We cast to float32 for predictable numerics.
    q = query.astype(np.float32, copy=False)
    e = embeddings.astype(np.float32, copy=False)
    scores = e @ q  # shape (count,)

    # argsort ascending; flip to get descending. For deterministic
    # tie-break by id, we fall back to a final stable sort below.
    effective_k = min(k, count)
    # Take the (effective_k + a few) top by score for the tie-break
    # buffer; using a full argsort keeps the code simple and is fine
    # for the small synthetic catalogs used in tests.
    order = np.argsort(-scores, kind="stable")

    # Filter to a generous candidate window: at most 4x k, capped at
    # the corpus size. This is enough for any plausible tie scenario.
    window = order[: min(count, max(effective_k * 4, effective_k + 16))]

    candidates = [(ids[i], float(scores[i])) for i in window]
    # Sort by (-score, id) — matches the mobile contract.
    candidates.sort(key=lambda row: (-row[1], row[0]))
    return candidates[:effective_k]


def recall_at_k(
    ground_truth: list[list[str]],
    candidates: list[list[str]],
    k: int,
) -> float:
    """Compute recall@K: for each query, what fraction of the
    ground-truth top-K is included in the candidate top-K?

    Both inputs are lists of id lists; identical-length outer lists
    are required.
    """

    if len(ground_truth) != len(candidates):
        raise ValueError(
            f"ground_truth length {len(ground_truth)} disagrees with "
            f"candidates length {len(candidates)}"
        )
    if not ground_truth:
        return 1.0

    hits = 0
    total = 0
    for gt, cand in zip(ground_truth, candidates):
        gt_k = set(gt[:k])
        cand_k = set(cand[:k])
        hits += len(gt_k & cand_k)
        total += min(k, len(gt_k))
    if total == 0:
        return 1.0
    return hits / total
