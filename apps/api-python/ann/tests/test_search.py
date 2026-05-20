"""Brute-force search + recall@K benchmarks.

The mobile side ships an FP16-quantised flat index. The benchmark
here builds an FP16 index from the same synthetic corpus, runs the
reference brute-force search over the round-tripped float32 view,
and confirms recall@10 against the FP32 ground truth ≥ 95 % — the
recall target the orchestrator brief calls for.
"""

from __future__ import annotations

import numpy as np
import pytest

from ann.format import DTYPE_FLOAT16, DTYPE_FLOAT32, pack_index, unpack_index
from ann.search import flat_topk, recall_at_k


def _make_unit_norm(rng: np.random.Generator, count: int, dim: int) -> np.ndarray:
    raw = rng.normal(size=(count, dim)).astype(np.float32)
    norms = np.linalg.norm(raw, axis=1, keepdims=True)
    return raw / np.where(norms == 0.0, 1.0, norms)


class TestFlatTopkContract:
    def test_returns_descending_by_score(self) -> None:
        rng = np.random.default_rng(7)
        embeddings = _make_unit_norm(rng, count=10, dim=4)
        ids = [f"id-{i}" for i in range(10)]
        query = embeddings[3].copy()

        results = flat_topk(query, embeddings, ids, k=5)
        scores = [score for _, score in results]
        assert scores == sorted(scores, reverse=True)
        assert results[0][0] == "id-3"
        assert pytest.approx(results[0][1], abs=1e-6) == 1.0

    def test_returns_at_most_k(self) -> None:
        rng = np.random.default_rng(8)
        embeddings = _make_unit_norm(rng, count=3, dim=4)
        ids = ["a", "b", "c"]
        results = flat_topk(embeddings[0], embeddings, ids, k=10)
        assert len(results) == 3

    def test_empty_corpus(self) -> None:
        results = flat_topk(
            np.zeros((4,), dtype=np.float32),
            np.empty((0, 4), dtype=np.float32),
            [],
            k=5,
        )
        assert results == []

    def test_k_zero(self) -> None:
        rng = np.random.default_rng(9)
        embeddings = _make_unit_norm(rng, count=3, dim=4)
        ids = ["a", "b", "c"]
        assert flat_topk(embeddings[0], embeddings, ids, k=0) == []

    def test_ties_broken_by_id_ascending(self) -> None:
        # Hand-craft a corpus where two rows are identical so scores tie.
        embeddings = np.array(
            [[1.0, 0.0], [1.0, 0.0], [0.0, 1.0]],
            dtype=np.float32,
        )
        # No need to renormalise — already unit length.
        ids = ["row-z", "row-a", "row-mid"]
        query = np.array([1.0, 0.0], dtype=np.float32)

        results = flat_topk(query, embeddings, ids, k=2)
        # Two tied at the top; ascending-by-id ⇒ row-a then row-z.
        assert [row[0] for row in results] == ["row-a", "row-z"]

    def test_dim_mismatch_raises(self) -> None:
        with pytest.raises(ValueError, match="dim"):
            flat_topk(
                np.zeros((4,), dtype=np.float32),
                np.zeros((3, 8), dtype=np.float32),
                ["a", "b", "c"],
                k=2,
            )

    def test_matches_argsort_reference(self) -> None:
        rng = np.random.default_rng(11)
        embeddings = _make_unit_norm(rng, count=50, dim=12)
        ids = [f"id-{i:03d}" for i in range(50)]
        query = _make_unit_norm(rng, count=1, dim=12)[0]

        # Reference numpy ordering (note: this does not enforce the
        # tie-break rule but unit-norm float32 dot products rarely
        # tie exactly with this seed).
        reference = np.argsort(-(embeddings @ query), kind="stable")[:10]
        candidate_ids = [row[0] for row in flat_topk(query, embeddings, ids, k=10)]
        assert candidate_ids == [ids[i] for i in reference]


class TestRecallAtK:
    def test_perfect_recall(self) -> None:
        gt = [["a", "b", "c"]]
        cand = [["a", "b", "c"]]
        assert recall_at_k(gt, cand, k=3) == 1.0

    def test_zero_recall(self) -> None:
        gt = [["a", "b", "c"]]
        cand = [["x", "y", "z"]]
        assert recall_at_k(gt, cand, k=3) == 0.0

    def test_partial(self) -> None:
        gt = [["a", "b", "c", "d", "e"]]
        cand = [["a", "b", "c", "x", "y"]]
        # 3 of 5 in top-K.
        assert pytest.approx(recall_at_k(gt, cand, k=5), abs=1e-9) == 3 / 5

    def test_mismatched_lengths_raises(self) -> None:
        with pytest.raises(ValueError, match="length"):
            recall_at_k([["a"]], [["a"], ["b"]], k=1)


class TestFp16Recall:
    """The headline recall@10 benchmark — FP16 vs FP32 on a 5 k corpus."""

    def test_fp16_recall_at_10_above_95_percent(self) -> None:
        rng = np.random.default_rng(2026_05_20)
        count = 5_000
        dim = 32
        embeddings_f32 = _make_unit_norm(rng, count=count, dim=dim)
        ids = [f"p-{i:05d}" for i in range(count)]

        # Pack to FP16 then unpack — what the runtime sees.
        buffer = pack_index(
            ids=ids,
            embeddings=embeddings_f32,
            id_length=8,
            dtype_tag=DTYPE_FLOAT16,
        )
        _, recovered_ids, embeddings_f16_decoded = unpack_index(buffer)
        # Re-normalise post-quantisation — the mobile loader can do
        # this too, but for the benchmark we want to measure pure
        # quantisation error without re-normalisation aliasing.
        embeddings_f16_unnormalised = embeddings_f16_decoded

        n_queries = 1_000
        queries = _make_unit_norm(rng, count=n_queries, dim=dim)

        gt_topk = []
        cand_topk = []
        for q in queries:
            gt_topk.append(
                [row[0] for row in flat_topk(q, embeddings_f32, ids, k=10)]
            )
            cand_topk.append(
                [
                    row[0]
                    for row in flat_topk(
                        q, embeddings_f16_unnormalised, recovered_ids, k=10
                    )
                ]
            )

        recall = recall_at_k(gt_topk, cand_topk, k=10)
        # Stage rule target is ≥ 95 %. We expect FP16 to land near
        # 100 % on this corpus; the assertion is the binding contract.
        assert recall >= 0.95, f"recall@10 dropped to {recall:.4f}"

    def test_fp32_recall_is_exactly_one(self) -> None:
        rng = np.random.default_rng(20)
        count = 200
        dim = 16
        embeddings = _make_unit_norm(rng, count=count, dim=dim)
        ids = [f"p-{i:03d}" for i in range(count)]
        buffer = pack_index(
            ids=ids,
            embeddings=embeddings,
            id_length=8,
            dtype_tag=DTYPE_FLOAT32,
        )
        _, recovered_ids, recovered_embeddings = unpack_index(buffer)

        queries = _make_unit_norm(rng, count=64, dim=dim)
        gt_topk = []
        cand_topk = []
        for q in queries:
            gt_topk.append([row[0] for row in flat_topk(q, embeddings, ids, k=5)])
            cand_topk.append(
                [
                    row[0]
                    for row in flat_topk(q, recovered_embeddings, recovered_ids, k=5)
                ]
            )
        assert recall_at_k(gt_topk, cand_topk, k=5) == 1.0
