// Gradient field + row/column projection helpers.
//
// Edges in an image are positions of high luminance gradient.
// A Pokémon card placed against a contrasting background produces
// four strong edges — top, bottom, left, right — that our
// rectangle finder will detect by projecting the gradient field
// along its two axes.
//
// We use a cheap two-tap finite difference rather than a full
// 3×3 Sobel filter: it's about 3× faster, and the row/column
// projection step downstream already does its own smoothing
// (summing across an axis suppresses point noise).

/**
 * A gradient field has the same dimensions as the input
 * grayscale image. Each entry is the magnitude of the local
 * gradient (sum of horizontal + vertical absolute differences,
 * clamped to byte range).
 */
export interface GradientField {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
  /**
   * Horizontal gradient component at `(x, y)`. Kept separately
   * from {@link verticalGradient} because the projection helpers
   * sum each axis independently — vertical-card-edges contribute
   * mostly to the horizontal-gradient column projection.
   */
  readonly horizontal: Uint8Array;
  readonly vertical: Uint8Array;
}

/**
 * Compute the gradient field of a grayscale buffer using a
 * symmetric 2-tap finite difference:
 *
 *   `gx(x, y) = |G(x+1, y) - G(x-1, y)|`
 *   `gy(x, y) = |G(x, y+1) - G(x, y-1)|`
 *   `data(x, y) = clamp(gx + gy, 0, 255)`
 *
 * Boundary pixels (where one of the neighbours is off the grid)
 * are set to zero. The output buffers have the same dimensions as
 * the input so callers can index without remembering an offset.
 */
export function computeGradientField(
  gray: Uint8Array,
  width: number,
  height: number,
): GradientField {
  'worklet';
  if (gray.length !== width * height) {
    throw new Error(
      `computeGradientField: gray length ${gray.length} does not match ${width}×${height}`,
    );
  }
  const horizontal = new Uint8Array(width * height);
  const vertical = new Uint8Array(width * height);
  const data = new Uint8Array(width * height);
  // The interior loop skips the 1-pixel border where one of the
  // taps would fall off-grid. Boundary entries stay at zero,
  // which is the right "no gradient information" sentinel for
  // the downstream projection.
  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width;
    const rowAbove = (y - 1) * width;
    const rowBelow = (y + 1) * width;
    for (let x = 1; x < width - 1; x += 1) {
      const i = row + x;
      const left = gray[row + (x - 1)] ?? 0;
      const right = gray[row + (x + 1)] ?? 0;
      const above = gray[rowAbove + x] ?? 0;
      const below = gray[rowBelow + x] ?? 0;
      const gx = Math.abs(right - left);
      const gy = Math.abs(below - above);
      horizontal[i] = gx;
      vertical[i] = gy;
      const sum = gx + gy;
      data[i] = sum > 255 ? 255 : sum;
    }
  }
  return { data, horizontal, vertical, width, height };
}

/**
 * Activity profiles — the row and column sums used by the
 * rectangle finder. Indices match the source grid: `rowActivity[i]`
 * is the sum of vertical gradients on row `i`; `colActivity[j]`
 * is the sum of horizontal gradients on column `j`.
 *
 * Using `Float32Array` keeps the math precise for grids large
 * enough to overflow `Uint16Array` (a 128-row × 255-max grid sums
 * to ~32k per row, which is uint16's ceiling).
 */
export interface ActivityProfiles {
  readonly rowActivity: Float32Array;
  readonly colActivity: Float32Array;
  readonly width: number;
  readonly height: number;
}

/**
 * Project the gradient field along each axis. Vertical edges
 * (left + right sides of a card) appear as peaks in
 * `colActivity`; horizontal edges (top + bottom) appear as peaks
 * in `rowActivity`. The rectangle finder scans inward from each
 * profile boundary to locate the card edges.
 */
export function computeProjections(field: GradientField): ActivityProfiles {
  'worklet';
  const { horizontal, vertical, width, height } = field;
  const rowActivity = new Float32Array(height);
  const colActivity = new Float32Array(width);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      const i = row + x;
      rowSum += vertical[i] ?? 0;
      colActivity[x] = (colActivity[x] ?? 0) + (horizontal[i] ?? 0);
    }
    rowActivity[y] = rowSum;
  }
  return { rowActivity, colActivity, width, height };
}
