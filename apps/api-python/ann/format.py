"""Binary layout for the on-device ANN index.

The format is intentionally minimal — no external library, no
self-describing field names, no compression. Mobile reads the
:func:`unpack_index` output through a TypeScript port that mirrors
this file byte-for-byte (see ``apps/mobile/src/scanner/ann/format.ts``).

Layout
------

All integers are unsigned little-endian, all floats follow IEEE 754::

    offset  size  field
    ----------------------------------------------------------
    0       4     magic         = 0xB1DE1A11  ("BINDEXALL")
    4       4     version       = INDEX_FORMAT_VERSION (== 1)
    8       4     dim           — embedding dimensionality
    12      4     count         — number of printings
    16      4     dtype         — 0 = float32, 1 = float16
    20      4     idLength      — bytes per printing id
    24      8     reserved (zeroed for v1)
    32      count * idLength bytes — ASCII ids, NUL-padded
    32 + count*idLength  count * dim * sizeof(dtype) bytes — embeddings
                                                            (row-major)

Header is exactly :data:`HEADER_SIZE_BYTES` bytes. We keep a small
reserved gap so v2 can add a couple of fields (e.g. a second metric)
without shifting the body.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass

import numpy as np


# Header constants ----------------------------------------------------------

#: 32-bit magic written at the head of every index file. Spells
#: ``BINDEXALL`` if you squint at the hex; we use it as a smoke test
#: that the runtime is reading something we actually produced.
INDEX_MAGIC: int = 0xB1DE1A11

#: Format version. Bump (and the loader's accepted set) on a
#: backwards-incompatible change.
INDEX_FORMAT_VERSION: int = 1

#: Total bytes occupied by the file header before any ids or vectors.
HEADER_SIZE_BYTES: int = 32

#: dtype tag for float32 embeddings.
DTYPE_FLOAT32: int = 0

#: dtype tag for float16 embeddings.
DTYPE_FLOAT16: int = 1

_DTYPE_TAGS: dict[int, np.dtype] = {
    DTYPE_FLOAT32: np.dtype("<f4"),
    DTYPE_FLOAT16: np.dtype("<f2"),
}

_DTYPE_NAMES: dict[int, str] = {
    DTYPE_FLOAT32: "float32",
    DTYPE_FLOAT16: "float16",
}

_DTYPE_TAGS_BY_NAME: dict[str, int] = {v: k for k, v in _DTYPE_NAMES.items()}


def dtype_name_for_tag(tag: int) -> str:
    """Return the textual dtype name for a numeric tag."""

    try:
        return _DTYPE_NAMES[tag]
    except KeyError as exc:
        raise ValueError(f"unknown dtype tag {tag!r}") from exc


def dtype_tag_for_name(name: str) -> int:
    """Return the numeric dtype tag for a textual dtype name."""

    try:
        return _DTYPE_TAGS_BY_NAME[name]
    except KeyError as exc:
        raise ValueError(
            f"unknown dtype name {name!r}; expected {sorted(_DTYPE_TAGS_BY_NAME)}"
        ) from exc


@dataclass(frozen=True)
class IndexHeader:
    """Decoded header — values are unsigned int but typed as ``int``.

    Returned by :func:`unpack_header`; consumed by
    :func:`unpack_index` and by the test suite.
    """

    magic: int
    version: int
    dim: int
    count: int
    dtype: int
    id_length: int


class IndexFormatError(ValueError):
    """Raised when the on-disk binary layout disagrees with our schema."""


def pack_index(
    *,
    ids: list[str],
    embeddings: np.ndarray,
    id_length: int,
    dtype_tag: int,
) -> bytes:
    """Pack ``(ids, embeddings)`` into the on-disk layout.

    ``ids`` must be ASCII; entries shorter than ``id_length`` are
    NUL-padded; longer entries raise :class:`IndexFormatError`. The
    ``embeddings`` array must be ``(count, dim)`` float32 — we
    downcast to the requested ``dtype_tag`` here so callers don't have
    to think about FP16 sentinels.
    """

    if dtype_tag not in _DTYPE_TAGS:
        raise IndexFormatError(
            f"unknown dtype tag {dtype_tag!r}; expected {sorted(_DTYPE_TAGS)}"
        )
    if embeddings.ndim != 2:
        raise IndexFormatError(
            f"embeddings must be 2-D, got shape {embeddings.shape!r}"
        )
    count, dim = embeddings.shape
    if len(ids) != count:
        raise IndexFormatError(
            f"ids length {len(ids)} disagrees with embeddings count {count}"
        )
    if id_length <= 0:
        raise IndexFormatError(f"id_length must be > 0; got {id_length!r}")

    storage_dtype = _DTYPE_TAGS[dtype_tag]

    encoded_ids = bytearray()
    for index, id_value in enumerate(ids):
        encoded = id_value.encode("ascii")
        if len(encoded) > id_length:
            raise IndexFormatError(
                f"id at index {index} is {len(encoded)} bytes — "
                f"exceeds id_length={id_length}"
            )
        # NUL-pad to fixed width.
        encoded_ids.extend(encoded)
        encoded_ids.extend(b"\x00" * (id_length - len(encoded)))

    body_vectors = np.ascontiguousarray(embeddings.astype(storage_dtype, copy=False))

    header = struct.pack(
        "<IIIIIIQ",
        INDEX_MAGIC,
        INDEX_FORMAT_VERSION,
        int(dim),
        int(count),
        int(dtype_tag),
        int(id_length),
        0,  # reserved
    )
    assert len(header) == HEADER_SIZE_BYTES, (
        f"header size drift: {len(header)} != {HEADER_SIZE_BYTES}"
    )
    return bytes(header) + bytes(encoded_ids) + body_vectors.tobytes(order="C")


def unpack_header(buffer: bytes | bytearray | memoryview) -> IndexHeader:
    """Decode the 32-byte header. Raises on magic / version mismatch.

    The reserved ``u64`` is read and ignored — present only to keep
    the body offset stable across future format bumps.
    """

    if len(buffer) < HEADER_SIZE_BYTES:
        raise IndexFormatError(
            f"buffer too short for header: {len(buffer)} < {HEADER_SIZE_BYTES}"
        )
    magic, version, dim, count, dtype, id_length, _reserved = struct.unpack_from(
        "<IIIIIIQ", buffer, 0
    )
    if magic != INDEX_MAGIC:
        raise IndexFormatError(
            f"magic mismatch: 0x{magic:08X} != 0x{INDEX_MAGIC:08X}"
        )
    if version != INDEX_FORMAT_VERSION:
        raise IndexFormatError(
            f"unsupported format version {version}; this reader expects "
            f"{INDEX_FORMAT_VERSION}"
        )
    if dtype not in _DTYPE_TAGS:
        raise IndexFormatError(f"unknown dtype tag {dtype!r}")
    return IndexHeader(
        magic=magic,
        version=version,
        dim=int(dim),
        count=int(count),
        dtype=int(dtype),
        id_length=int(id_length),
    )


def unpack_index(buffer: bytes | bytearray | memoryview) -> tuple[
    IndexHeader, list[str], np.ndarray
]:
    """Decode a full index buffer.

    Returns the decoded header, the list of NUL-stripped ASCII ids,
    and the embeddings as a ``(count, dim)`` float32 array
    (FP16-stored embeddings are decoded back to float32 here so that
    the test reference and the on-device runtime share a numeric
    contract).
    """

    header = unpack_header(buffer)
    expected_size = (
        HEADER_SIZE_BYTES
        + header.count * header.id_length
        + header.count * header.dim * _DTYPE_TAGS[header.dtype].itemsize
    )
    if len(buffer) != expected_size:
        raise IndexFormatError(
            f"buffer length {len(buffer)} disagrees with declared size "
            f"{expected_size} (count={header.count}, dim={header.dim}, "
            f"id_length={header.id_length}, dtype={header.dtype})"
        )

    id_offset = HEADER_SIZE_BYTES
    body_offset = id_offset + header.count * header.id_length

    ids: list[str] = []
    for index in range(header.count):
        start = id_offset + index * header.id_length
        end = start + header.id_length
        raw = bytes(buffer[start:end])
        # Trim trailing NULs introduced by `pack_index`.
        ids.append(raw.rstrip(b"\x00").decode("ascii"))

    body_dtype = _DTYPE_TAGS[header.dtype]
    body = np.frombuffer(
        bytes(buffer[body_offset:]),
        dtype=body_dtype,
        count=header.count * header.dim,
    ).reshape(header.count, header.dim)
    # Always return float32 for downstream numerics. The FP16 round-
    # trip lives in the storage dtype, not in the runtime view.
    if body.dtype != np.float32:
        body = body.astype(np.float32, copy=True)
    else:
        body = np.ascontiguousarray(body)

    return header, ids, body
