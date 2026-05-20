"""Tests for the binary index layout."""

from __future__ import annotations

import struct

import numpy as np
import pytest

from ann.format import (
    DTYPE_FLOAT16,
    DTYPE_FLOAT32,
    HEADER_SIZE_BYTES,
    INDEX_FORMAT_VERSION,
    INDEX_MAGIC,
    IndexFormatError,
    dtype_name_for_tag,
    dtype_tag_for_name,
    pack_index,
    unpack_header,
    unpack_index,
)


def _make_embeddings(count: int, dim: int, *, seed: int = 1) -> np.ndarray:
    rng = np.random.default_rng(seed)
    raw = rng.normal(size=(count, dim)).astype(np.float32)
    norms = np.linalg.norm(raw, axis=1, keepdims=True)
    return raw / np.where(norms == 0.0, 1.0, norms)


class TestPackUnpackRoundTrip:
    def test_round_trip_float32(self) -> None:
        embeddings = _make_embeddings(count=5, dim=8)
        ids = [f"id-{i:02d}" for i in range(5)]

        buffer = pack_index(
            ids=ids,
            embeddings=embeddings,
            id_length=8,
            dtype_tag=DTYPE_FLOAT32,
        )
        header, recovered_ids, recovered_embeddings = unpack_index(buffer)

        assert header.magic == INDEX_MAGIC
        assert header.version == INDEX_FORMAT_VERSION
        assert header.dim == 8
        assert header.count == 5
        assert header.dtype == DTYPE_FLOAT32
        assert header.id_length == 8
        assert recovered_ids == ids
        np.testing.assert_array_equal(recovered_embeddings, embeddings)

    def test_round_trip_float16_within_tolerance(self) -> None:
        embeddings = _make_embeddings(count=11, dim=16, seed=2)
        ids = [f"id-{i:04d}" for i in range(11)]

        buffer = pack_index(
            ids=ids,
            embeddings=embeddings,
            id_length=8,
            dtype_tag=DTYPE_FLOAT16,
        )
        header, recovered_ids, recovered_embeddings = unpack_index(buffer)

        assert header.dtype == DTYPE_FLOAT16
        assert recovered_ids == ids
        # FP16 quantisation is lossy but small for unit-norm vectors.
        np.testing.assert_allclose(
            recovered_embeddings, embeddings, atol=1e-3, rtol=0
        )

    def test_round_trip_empty(self) -> None:
        empty = np.empty((0, 16), dtype=np.float32)
        buffer = pack_index(
            ids=[], embeddings=empty, id_length=36, dtype_tag=DTYPE_FLOAT32
        )
        header, ids, embeddings = unpack_index(buffer)
        assert header.count == 0
        assert ids == []
        assert embeddings.shape == (0, 16)

    def test_id_padding_is_stripped(self) -> None:
        embeddings = _make_embeddings(count=2, dim=4)
        buffer = pack_index(
            ids=["a", "longer"],
            embeddings=embeddings,
            id_length=12,
            dtype_tag=DTYPE_FLOAT32,
        )
        _, ids, _ = unpack_index(buffer)
        assert ids == ["a", "longer"]

    def test_byte_size_is_exact(self) -> None:
        embeddings = _make_embeddings(count=3, dim=4)
        buffer = pack_index(
            ids=["x", "y", "z"],
            embeddings=embeddings,
            id_length=4,
            dtype_tag=DTYPE_FLOAT16,
        )
        expected = HEADER_SIZE_BYTES + 3 * 4 + 3 * 4 * 2
        assert len(buffer) == expected


class TestErrorPaths:
    def test_rejects_unknown_dtype_tag(self) -> None:
        embeddings = _make_embeddings(count=1, dim=4)
        with pytest.raises(IndexFormatError, match="dtype tag"):
            pack_index(
                ids=["x"],
                embeddings=embeddings,
                id_length=4,
                dtype_tag=42,
            )

    def test_rejects_ids_count_mismatch(self) -> None:
        embeddings = _make_embeddings(count=2, dim=4)
        with pytest.raises(IndexFormatError, match="ids length"):
            pack_index(
                ids=["only-one"],
                embeddings=embeddings,
                id_length=8,
                dtype_tag=DTYPE_FLOAT32,
            )

    def test_rejects_id_too_long(self) -> None:
        embeddings = _make_embeddings(count=1, dim=4)
        with pytest.raises(IndexFormatError, match="exceeds id_length"):
            pack_index(
                ids=["aaaaaaaa"],
                embeddings=embeddings,
                id_length=4,
                dtype_tag=DTYPE_FLOAT32,
            )

    def test_rejects_non_2d_embeddings(self) -> None:
        with pytest.raises(IndexFormatError, match="2-D"):
            pack_index(
                ids=["x"],
                embeddings=np.zeros((4,), dtype=np.float32),
                id_length=4,
                dtype_tag=DTYPE_FLOAT32,
            )

    def test_rejects_zero_id_length(self) -> None:
        embeddings = _make_embeddings(count=1, dim=4)
        with pytest.raises(IndexFormatError, match="id_length"):
            pack_index(
                ids=["x"],
                embeddings=embeddings,
                id_length=0,
                dtype_tag=DTYPE_FLOAT32,
            )


class TestUnpackHeader:
    def test_rejects_short_buffer(self) -> None:
        with pytest.raises(IndexFormatError, match="too short"):
            unpack_header(b"\x00")

    def test_rejects_magic_mismatch(self) -> None:
        header = struct.pack(
            "<IIIIIIQ", 0xDEADBEEF, INDEX_FORMAT_VERSION, 4, 1, 0, 4, 0
        )
        with pytest.raises(IndexFormatError, match="magic"):
            unpack_header(header)

    def test_rejects_version_mismatch(self) -> None:
        header = struct.pack("<IIIIIIQ", INDEX_MAGIC, 999, 4, 1, 0, 4, 0)
        with pytest.raises(IndexFormatError, match="version"):
            unpack_header(header)

    def test_rejects_unknown_dtype(self) -> None:
        header = struct.pack(
            "<IIIIIIQ", INDEX_MAGIC, INDEX_FORMAT_VERSION, 4, 1, 9, 4, 0
        )
        with pytest.raises(IndexFormatError, match="dtype"):
            unpack_header(header)

    def test_rejects_size_mismatch(self) -> None:
        embeddings = _make_embeddings(count=2, dim=4)
        buffer = pack_index(
            ids=["a", "b"],
            embeddings=embeddings,
            id_length=4,
            dtype_tag=DTYPE_FLOAT32,
        )
        # Truncate the body — should fail.
        with pytest.raises(IndexFormatError, match="buffer length"):
            unpack_index(buffer[:-1])


class TestDtypeNames:
    def test_round_trip_names(self) -> None:
        assert dtype_name_for_tag(DTYPE_FLOAT32) == "float32"
        assert dtype_name_for_tag(DTYPE_FLOAT16) == "float16"
        assert dtype_tag_for_name("float32") == DTYPE_FLOAT32
        assert dtype_tag_for_name("float16") == DTYPE_FLOAT16

    def test_unknown_name_raises(self) -> None:
        with pytest.raises(ValueError, match="unknown dtype name"):
            dtype_tag_for_name("uint8")
