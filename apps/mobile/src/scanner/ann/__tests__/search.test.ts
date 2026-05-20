import { describe, expect, it } from 'vitest';

import { AnnSearchError, searchKnnFlat } from '../search';
import { makeRng, randomUnitVector, unitNormMatrix } from './test-utils';

describe('searchKnnFlat — contract', () => {
  it('returns top-K ordered by descending score', () => {
    const catalog = unitNormMatrix([
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ]);
    const ids = ['p-0', 'p-1', 'p-2', 'p-3'];
    const query = unitNormMatrix([[1, 0.1, 0.05, 0]]);

    const results = searchKnnFlat(query, catalog, ids, 4, 3);
    expect(results.map((r) => r.printingId)).toEqual(['p-0', 'p-1', 'p-2']);
    for (let i = 1; i < results.length; i += 1) {
      expect((results[i - 1]?.score ?? 0)).toBeGreaterThanOrEqual(
        results[i]?.score ?? 0,
      );
    }
  });

  it('caps results at the catalog size when k > count', () => {
    const catalog = unitNormMatrix([
      [1, 0],
      [0, 1],
    ]);
    const results = searchKnnFlat(
      unitNormMatrix([[1, 0]]),
      catalog,
      ['a', 'b'],
      2,
      10,
    );
    expect(results).toHaveLength(2);
  });

  it('returns empty for k = 0', () => {
    const catalog = unitNormMatrix([[1, 0]]);
    expect(searchKnnFlat(catalog, catalog, ['a'], 2, 0)).toEqual([]);
  });

  it('returns empty for empty catalog', () => {
    expect(
      searchKnnFlat(
        new Float32Array([1, 0]),
        new Float32Array(0),
        [],
        2,
        5,
      ),
    ).toEqual([]);
  });

  it('throws AnnSearchError on dim mismatch', () => {
    expect(() =>
      searchKnnFlat(
        new Float32Array([1, 0, 0]),
        new Float32Array([1, 0]),
        ['a'],
        2,
        1,
      ),
    ).toThrow(AnnSearchError);
  });

  it('throws AnnSearchError on bad catalog size', () => {
    expect(() =>
      searchKnnFlat(
        new Float32Array([1, 0]),
        new Float32Array([1, 0, 0]),
        ['a', 'b'],
        2,
        1,
      ),
    ).toThrow(AnnSearchError);
  });

  it('reports distance = 1 - score', () => {
    const catalog = unitNormMatrix([
      [1, 0, 0, 0],
      [0, 1, 0, 0],
    ]);
    const results = searchKnnFlat(
      unitNormMatrix([[1, 0, 0, 0]]),
      catalog,
      ['a', 'b'],
      4,
      2,
    );
    expect(results[0]?.distance).toBeCloseTo(0, 6);
    expect(results[1]?.distance).toBeCloseTo(1, 6);
  });
});

describe('searchKnnFlat — tie breaking', () => {
  it('breaks ties by id ascending', () => {
    const catalog = new Float32Array([
      1, 0, 0, 0,
      1, 0, 0, 0,
      0, 1, 0, 0,
    ]);
    const ids = ['z', 'a', 'm'];
    const query = new Float32Array([1, 0, 0, 0]);
    const results = searchKnnFlat(query, catalog, ids, 4, 2);
    expect(results.map((r) => r.printingId)).toEqual(['a', 'z']);
  });

  it('honors a custom tie-breaker', () => {
    const catalog = new Float32Array([
      1, 0,
      1, 0,
    ]);
    const ids = ['alpha', 'beta'];
    const query = new Float32Array([1, 0]);
    const results = searchKnnFlat(query, catalog, ids, 2, 2, (a, b) =>
      a > b ? -1 : a < b ? 1 : 0,
    );
    expect(results.map((r) => r.printingId)).toEqual(['beta', 'alpha']);
  });
});

describe('searchKnnFlat — agrees with brute-force reference', () => {
  it('matches np.argsort on a small synthetic corpus', () => {
    const rng = makeRng(0xdeadbeef);
    const dim = 8;
    const count = 64;
    const rows: number[][] = [];
    for (let i = 0; i < count; i += 1) {
      const vec: number[] = [];
      for (let d = 0; d < dim; d += 1) {
        vec.push(2 * rng() - 1);
      }
      rows.push(vec);
    }
    const catalog = unitNormMatrix(rows);
    const ids = rows.map((_, i) => `p-${i.toString().padStart(3, '0')}`);

    const query = randomUnitVector(dim, rng);

    // Brute-force reference computed inline.
    const scores: { id: string; score: number }[] = [];
    for (let i = 0; i < count; i += 1) {
      let s = 0;
      for (let d = 0; d < dim; d += 1) {
        s += (catalog[i * dim + d] ?? 0) * (query[d] ?? 0);
      }
      scores.push({ id: ids[i] ?? '', score: s });
    }
    scores.sort((a, b) => (a.score === b.score ? a.id.localeCompare(b.id) : b.score - a.score));
    const expected = scores.slice(0, 10).map((row) => row.id);

    const got = searchKnnFlat(query, catalog, ids, dim, 10).map(
      (row) => row.printingId,
    );
    expect(got).toEqual(expected);
  });
});
