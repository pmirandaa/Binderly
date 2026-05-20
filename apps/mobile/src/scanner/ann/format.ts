// Binary reader for the on-device ANN index.
//
// Mirrors `apps/api-python/ann/format.py`. All multi-byte integers
// are little-endian; floats are IEEE 754. The format is purpose-
// built to be one `ArrayBuffer` `slice` — no JSON parsing for the
// bulk data, no native bindings.
//
// Layout (recap; full spec in the Python sibling):
//
//   offset  size           field
//   0       4              magic         = 0xB1DE1A11
//   4       4              version       = 1
//   8       4              dim
//   12      4              count
//   16      4              dtype         (0 = float32, 1 = float16)
//   20      4              idLength
//   24      8              reserved
//   32      count*idLength ASCII ids, NUL-padded
//   …       count*dim*sizeof(dtype)  embeddings (row-major)

export const INDEX_MAGIC = 0xb1de1a11;
export const INDEX_FORMAT_VERSION = 1;
export const HEADER_SIZE_BYTES = 32;

export const DTYPE_FLOAT32 = 0;
export const DTYPE_FLOAT16 = 1;

export interface AnnIndexHeader {
  readonly magic: number;
  readonly version: number;
  readonly dim: number;
  readonly count: number;
  /** Numeric dtype tag — 0 = float32, 1 = float16. */
  readonly dtype: number;
  readonly idLength: number;
}

export interface AnnIndexBody {
  readonly header: AnnIndexHeader;
  readonly ids: readonly string[];
  /** Always float32; FP16-stored embeddings are decoded eagerly. */
  readonly embeddings: Float32Array;
}

export class AnnFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnnFormatError';
  }
}

/**
 * Decode the 32-byte header. Rejects on magic / version / dtype
 * mismatch with a typed error.
 */
export function parseHeader(buffer: ArrayBuffer): AnnIndexHeader {
  if (buffer.byteLength < HEADER_SIZE_BYTES) {
    throw new AnnFormatError(
      `buffer too short for header: ${buffer.byteLength} < ${HEADER_SIZE_BYTES}`,
    );
  }
  const view = new DataView(buffer);
  const magic = view.getUint32(0, true);
  const version = view.getUint32(4, true);
  const dim = view.getUint32(8, true);
  const count = view.getUint32(12, true);
  const dtype = view.getUint32(16, true);
  const idLength = view.getUint32(20, true);
  if (magic !== INDEX_MAGIC) {
    throw new AnnFormatError(
      `magic mismatch: 0x${magic.toString(16).padStart(8, '0')} != 0x${INDEX_MAGIC.toString(16).padStart(8, '0')}`,
    );
  }
  if (version !== INDEX_FORMAT_VERSION) {
    throw new AnnFormatError(
      `unsupported format version ${version}; this reader expects ${INDEX_FORMAT_VERSION}`,
    );
  }
  if (dtype !== DTYPE_FLOAT32 && dtype !== DTYPE_FLOAT16) {
    throw new AnnFormatError(`unknown dtype tag ${dtype}`);
  }
  if (idLength === 0) {
    throw new AnnFormatError('idLength must be > 0');
  }
  return { magic, version, dim, count, dtype, idLength };
}

/**
 * Full decode. Returns the header, the ids as ASCII strings, and the
 * embeddings as a contiguous `Float32Array` of `count * dim` entries
 * (row-major). FP16-stored embeddings are decoded to FP32 here so
 * the runtime hot-loop never touches half-precision bytes.
 *
 * Throws `AnnFormatError` if the buffer length disagrees with the
 * declared `(count, dim, idLength, dtype)`.
 */
export function parseIndex(buffer: ArrayBuffer): AnnIndexBody {
  const header = parseHeader(buffer);
  const dtypeBytes = header.dtype === DTYPE_FLOAT32 ? 4 : 2;
  const expectedSize =
    HEADER_SIZE_BYTES +
    header.count * header.idLength +
    header.count * header.dim * dtypeBytes;
  if (buffer.byteLength !== expectedSize) {
    throw new AnnFormatError(
      `buffer length ${buffer.byteLength} disagrees with declared size ${expectedSize} (count=${header.count}, dim=${header.dim}, idLength=${header.idLength}, dtype=${header.dtype})`,
    );
  }

  const ids = decodeIds(buffer, header);
  const bodyOffset = HEADER_SIZE_BYTES + header.count * header.idLength;
  const embeddings = decodeEmbeddings(buffer, header, bodyOffset);
  return { header, ids, embeddings };
}

function decodeIds(buffer: ArrayBuffer, header: AnnIndexHeader): string[] {
  const ids: string[] = [];
  const bytes = new Uint8Array(buffer);
  const totalLen = header.count * header.idLength;
  const start = HEADER_SIZE_BYTES;
  for (let i = 0; i < header.count; i += 1) {
    const offset = start + i * header.idLength;
    let end = offset + header.idLength;
    // Strip trailing NULs introduced by pack_index padding.
    while (end > offset && bytes[end - 1] === 0) {
      end -= 1;
    }
    let str = '';
    for (let j = offset; j < end; j += 1) {
      // ids are ASCII by construction (UUIDs in production).
      str += String.fromCharCode(bytes[j] ?? 0);
    }
    ids.push(str);
  }
  // Cheap defensive use of `totalLen` to make sure the
  // computation stayed in-range (defends against an unused-var
  // lint and explicit underflow simultaneously).
  if (totalLen < 0) {
    throw new AnnFormatError('negative id segment length');
  }
  return ids;
}

function decodeEmbeddings(
  buffer: ArrayBuffer,
  header: AnnIndexHeader,
  bodyOffset: number,
): Float32Array {
  const elementCount = header.count * header.dim;
  if (elementCount === 0) {
    return new Float32Array(0);
  }
  if (header.dtype === DTYPE_FLOAT32) {
    // Copy out of the source buffer so the returned array owns its
    // backing memory — the caller may pass an asset-backed
    // ArrayBuffer whose lifetime is tied to the bundler.
    const src = new Float32Array(buffer, bodyOffset, elementCount);
    return new Float32Array(src);
  }
  // float16: decode each 16-bit word into a Float32 lane.
  const src = new Uint16Array(buffer, bodyOffset, elementCount);
  const out = new Float32Array(elementCount);
  for (let i = 0; i < elementCount; i += 1) {
    out[i] = decodeFloat16(src[i] ?? 0);
  }
  return out;
}

// IEEE 754 half-precision -> single-precision decoder.
//
// The half-precision format is sign:1 | exp:5 | mantissa:10.
// We branch on the exponent:
//   - 0:  subnormal or zero — encode 1.0e-14-class numbers as zero
//          for our purposes (catalog embeddings sit on the unit
//          hyper-sphere; subnormals literally cannot appear after
//          unit-norm preprocessing).
//   - 31: Inf or NaN — pass through as Inf/NaN.
//   - else: normal exponent → rebias from 15 to 127 and shift the
//          mantissa into the FP32 layout.
//
// This is the standard decoder shape; pulled inline (rather than
// using a polyfill) because Hermes does not ship one and we don't
// want a new runtime dep.
function decodeFloat16(word: number): number {
  const sign = (word & 0x8000) >> 15;
  const exp = (word & 0x7c00) >> 10;
  const mant = word & 0x03ff;
  if (exp === 0) {
    if (mant === 0) {
      return sign === 0 ? 0 : -0;
    }
    // Subnormal: value = (-1)^sign * mant * 2^-24
    const value = mant * 2 ** -24;
    return sign === 0 ? value : -value;
  }
  if (exp === 31) {
    if (mant === 0) {
      return sign === 0 ? Infinity : -Infinity;
    }
    return NaN;
  }
  // Normal — rebias exponent from 15 to 127.
  const value = (1 + mant / 1024) * 2 ** (exp - 15);
  return sign === 0 ? value : -value;
}

export { decodeFloat16 as __decodeFloat16ForTests };
