// Tests for `sql.ts`. Three layers:
//
//   1. Per-operator tests: each AST shape compiles to the expected
//      SQL fragment with the right placeholder pattern, and the
//      `params` array carries the literal values.
//   2. Injection-safety tests: a value containing SQL syntax shows
//      up only in `params`, never inlined into the `sql` string.
//   3. Round-trip property test: a small in-process SQL interpreter
//      that mirrors the exact grammar this compiler emits is run
//      against a corpus of generated random expressions; the
//      evaluator and the SQL interpreter must always agree.

import { describe, expect, it } from 'vitest';

import { evaluateExpression } from './evaluate.js';
import { expressionToSql } from './sql.js';

import type { CandidateItem, Expression } from './types.js';

// ============================================================
// Per-operator SQL tests
// ============================================================

describe('expressionToSql — eq', () => {
  it('emits a parameterized equality on a string field', () => {
    const r = expressionToSql({ type: 'eq', field: 'card.name', value: 'Charizard' });
    expect(r.sql).toBe('((card.name = $1) IS TRUE)');
    expect(r.params).toEqual(['Charizard']);
  });

  it('emits a parameterized equality on a number field', () => {
    const r = expressionToSql({ type: 'eq', field: 'card.hp', value: 200 });
    expect(r.sql).toBe('((card.hp = $1) IS TRUE)');
    expect(r.params).toEqual([200]);
  });

  it('emits a parameterized equality on a date field', () => {
    const r = expressionToSql({
      type: 'eq',
      field: 'set.releaseDate',
      value: '2022-02-25',
    });
    expect(r.sql).toBe('((set.release_date = $1) IS TRUE)');
    expect(r.params).toEqual(['2022-02-25']);
  });

  it('emits ANY() for an enumArray equality', () => {
    const r = expressionToSql({
      type: 'eq',
      field: 'printing.variantFlags',
      value: 'FIRST_EDITION',
    });
    expect(r.sql).toBe('(($1 = ANY(printing.variant_flags)) IS TRUE)');
    expect(r.params).toEqual(['FIRST_EDITION']);
  });

  it('emits IS NOT NULL for collection.isOwned eq true', () => {
    const r = expressionToSql({ type: 'eq', field: 'collection.isOwned', value: true });
    expect(r.sql).toBe('(collection_item.id IS NOT NULL)');
    expect(r.params).toEqual([]);
  });

  it('emits IS NULL for collection.isOwned eq false', () => {
    const r = expressionToSql({ type: 'eq', field: 'collection.isOwned', value: false });
    expect(r.sql).toBe('(collection_item.id IS NULL)');
    expect(r.params).toEqual([]);
  });
});

describe('expressionToSql — in', () => {
  it('emits a parameterized IN on a scalar field', () => {
    const r = expressionToSql({
      type: 'in',
      field: 'card.rarity',
      values: ['HOLO_RARE', 'ULTRA_RARE'],
    });
    expect(r.sql).toBe('((card.rarity IN ($1, $2)) IS TRUE)');
    expect(r.params).toEqual(['HOLO_RARE', 'ULTRA_RARE']);
  });

  it('emits the array-overlap operator for an enumArray IN', () => {
    const r = expressionToSql({
      type: 'in',
      field: 'printing.variantFlags',
      values: ['FIRST_EDITION', 'SHADOWLESS'],
    });
    expect(r.sql).toBe('((printing.variant_flags && ARRAY[$1, $2]::text[]) IS TRUE)');
    expect(r.params).toEqual(['FIRST_EDITION', 'SHADOWLESS']);
  });
});

describe('expressionToSql — range', () => {
  it('emits both bounds inclusively', () => {
    const r = expressionToSql({
      type: 'range',
      field: 'card.hp',
      min: 100,
      max: 250,
    });
    expect(r.sql).toBe('(((card.hp >= $1) AND (card.hp <= $2)) IS TRUE)');
    expect(r.params).toEqual([100, 250]);
  });

  it('emits exclusive bounds when minInclusive=false / maxInclusive=false', () => {
    const r = expressionToSql({
      type: 'range',
      field: 'card.hp',
      min: 100,
      max: 250,
      minInclusive: false,
      maxInclusive: false,
    });
    expect(r.sql).toBe('(((card.hp > $1) AND (card.hp < $2)) IS TRUE)');
    expect(r.params).toEqual([100, 250]);
  });

  it('emits min only when no max', () => {
    const r = expressionToSql({ type: 'range', field: 'card.hp', min: 100 });
    expect(r.sql).toBe('(((card.hp >= $1)) IS TRUE)');
    expect(r.params).toEqual([100]);
  });

  it('handles ISO date bounds', () => {
    const r = expressionToSql({
      type: 'range',
      field: 'set.releaseDate',
      min: '2022-01-01',
      max: '2022-12-31',
    });
    expect(r.sql).toBe('(((set.release_date >= $1) AND (set.release_date <= $2)) IS TRUE)');
    expect(r.params).toEqual(['2022-01-01', '2022-12-31']);
  });
});

describe('expressionToSql — exists', () => {
  it('emits IS NOT NULL for exists=true', () => {
    const r = expressionToSql({
      type: 'exists',
      field: 'card.illustrator',
      exists: true,
    });
    expect(r.sql).toBe('(card.illustrator IS NOT NULL)');
    expect(r.params).toEqual([]);
  });

  it('emits IS NULL for exists=false', () => {
    const r = expressionToSql({
      type: 'exists',
      field: 'card.illustrator',
      exists: false,
    });
    expect(r.sql).toBe('(card.illustrator IS NULL)');
    expect(r.params).toEqual([]);
  });

  it('handles exists on the synthetic isOwned', () => {
    const r = expressionToSql({
      type: 'exists',
      field: 'collection.isOwned',
      exists: true,
    });
    expect(r.sql).toBe('(collection_item.id IS NOT NULL)');
    expect(r.params).toEqual([]);
  });
});

describe('expressionToSql — boolean combinators', () => {
  it('emits AND with both children', () => {
    const r = expressionToSql({
      type: 'and',
      children: [
        { type: 'eq', field: 'card.name', value: 'Charizard' },
        { type: 'eq', field: 'card.language', value: 'en' },
      ],
    });
    expect(r.sql).toBe('(((card.name = $1) IS TRUE) AND ((card.language = $2) IS TRUE))');
    expect(r.params).toEqual(['Charizard', 'en']);
  });

  it('emits OR with both children', () => {
    const r = expressionToSql({
      type: 'or',
      children: [
        { type: 'eq', field: 'card.rarity', value: 'HOLO_RARE' },
        { type: 'eq', field: 'card.rarity', value: 'ULTRA_RARE' },
      ],
    });
    expect(r.sql).toBe('(((card.rarity = $1) IS TRUE) OR ((card.rarity = $2) IS TRUE))');
    expect(r.params).toEqual(['HOLO_RARE', 'ULTRA_RARE']);
  });

  it('emits NOT around its child', () => {
    const r = expressionToSql({
      type: 'not',
      child: { type: 'eq', field: 'card.name', value: 'Charizard' },
    });
    expect(r.sql).toBe('(NOT ((card.name = $1) IS TRUE))');
    expect(r.params).toEqual(['Charizard']);
  });

  it('emits a deeply-nested combination correctly', () => {
    const r = expressionToSql({
      type: 'and',
      children: [
        { type: 'eq', field: 'card.name', value: 'Charizard' },
        {
          type: 'or',
          children: [
            { type: 'eq', field: 'card.rarity', value: 'HOLO_RARE' },
            { type: 'eq', field: 'card.rarity', value: 'ULTRA_RARE' },
          ],
        },
      ],
    });
    expect(r.params).toEqual(['Charizard', 'HOLO_RARE', 'ULTRA_RARE']);
    expect(r.sql).toMatch(/AND/);
    expect(r.sql).toMatch(/OR/);
  });
});

describe('expressionToSql — aliases & paramIndexOffset', () => {
  it('respects custom aliases for every entity', () => {
    const r = expressionToSql(
      {
        type: 'and',
        children: [
          { type: 'eq', field: 'card.name', value: 'X' },
          { type: 'eq', field: 'set.code', value: 'swsh9' },
          { type: 'eq', field: 'printing.variantClass', value: 'HOLO' },
          { type: 'eq', field: 'collection.isOwned', value: true },
        ],
      },
      { aliases: { card: 'c', set: 's', printing: 'p', collectionItem: 'ci' } },
    );
    expect(r.sql).toContain('c.name');
    expect(r.sql).toContain('s.code');
    expect(r.sql).toContain('p.variant_class');
    expect(r.sql).toContain('ci.id IS NOT NULL');
  });

  it('uses default aliases when not provided', () => {
    const r = expressionToSql({ type: 'eq', field: 'set.code', value: 'swsh9' });
    expect(r.sql).toContain('set.code');
  });

  it('respects paramIndexOffset for stitching into a larger query', () => {
    const r = expressionToSql(
      {
        type: 'and',
        children: [
          { type: 'eq', field: 'card.name', value: 'A' },
          { type: 'eq', field: 'card.name', value: 'B' },
        ],
      },
      { paramIndexOffset: 5 },
    );
    expect(r.sql).toContain('$5');
    expect(r.sql).toContain('$6');
    expect(r.sql).not.toContain('$1');
    expect(r.params).toEqual(['A', 'B']);
  });
});

// ============================================================
// Injection safety
// ============================================================

describe('expressionToSql — injection safety', () => {
  const dangerousValues = [
    "'; DROP TABLE card;--",
    `1' OR '1'='1`,
    'foo); --',
    '\u0000',
    '\\',
    'literal $1 placeholder',
    'no\nlinebreak',
  ];

  for (const dangerous of dangerousValues) {
    it(`treats \`${dangerous.slice(0, 20)}…\` as a parameter, never inlined`, () => {
      const r = expressionToSql({ type: 'eq', field: 'card.name', value: dangerous });
      expect(r.params).toEqual([dangerous]);
      expect(r.sql).not.toContain(dangerous);
    });
  }

  it('treats a numeric value with SQL-injection-shaped string as a param', () => {
    const r = expressionToSql({
      type: 'in',
      field: 'card.rarity',
      values: ["';DROP", "');"],
    });
    expect(r.params).toEqual(["';DROP", "');"]);
    expect(r.sql).not.toContain('DROP');
    expect(r.sql).not.toContain("'");
  });

  it('treats every value in a complex expression as a param', () => {
    const r = expressionToSql({
      type: 'and',
      children: [
        { type: 'eq', field: 'card.name', value: "Mr. Mime'); --" },
        {
          type: 'in',
          field: 'card.rarity',
          values: ['HOLO_RARE', 'ULTRA_RARE'],
        },
        {
          type: 'range',
          field: 'card.hp',
          min: 100,
          max: 200,
        },
      ],
    });
    expect(r.params).toEqual(["Mr. Mime'); --", 'HOLO_RARE', 'ULTRA_RARE', 100, 200]);
    expect(r.sql).not.toContain('Mr. Mime');
    // The literal numbers also shouldn't appear inlined.
    expect(r.sql).not.toContain('100');
    expect(r.sql).not.toContain('200');
  });
});

// ============================================================
// Round-trip property test
// ============================================================
//
// We compile expressions through both `evaluateExpression` and a
// deliberate in-process SQL interpreter that walks the exact
// grammar `expressionToSql` emits — tokenize → recursive descent →
// boolean. The interpreter knows nothing about the AST; it only
// reads SQL strings + bound params + the candidate item.

describe('expressionToSql ⇔ evaluateExpression — round trip', () => {
  function rng(seed: number) {
    // Mulberry32 — small, deterministic PRNG.
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pick<T>(arr: readonly T[], r: () => number): T {
    return arr[Math.floor(r() * arr.length)] as T;
  }

  function genItem(r: () => number): CandidateItem {
    return {
      card: {
        name: pick(['Charizard', 'Blastoise', 'Venusaur', 'Pikachu', 'Mew'], r),
        number: pick(['001', '002', '018', 'GG12'], r),
        illustrator: r() < 0.7 ? pick(['5ban', 'Mitsuhiro', 'Ken Sugimori'], r) : null,
        language: pick(['en', 'jp'] as const, r),
        type: r() < 0.8 ? pick(['FIRE', 'WATER', 'GRASS', 'PSYCHIC'] as const, r) : null,
        subtype: r() < 0.9 ? pick(['POKEMON', 'TRAINER_ITEM', 'ENERGY_BASIC'] as const, r) : null,
        rarity:
          r() < 0.85
            ? pick(['COMMON', 'HOLO_RARE', 'ULTRA_RARE', 'SECRET_RARE'] as const, r)
            : null,
        hp: r() < 0.85 ? Math.floor(r() * 280) + 30 : null,
        retreatCost: r() < 0.8 ? Math.floor(r() * 5) : null,
      },
      set: {
        code: pick(['swsh9', 'sv1', 'base1', 'jp-cz'], r),
        name: pick(['Brilliant Stars', 'Scarlet & Violet', 'Base Set'], r),
        series: r() < 0.9 ? pick(['Sword & Shield', 'Scarlet & Violet', 'Base'], r) : null,
        language: pick(['en', 'jp'] as const, r),
        releaseDate: pick(
          ['1999-01-09', '2022-02-25', '2023-03-31', '2024-09-13', '2025-04-01'],
          r,
        ),
        printedTotal: r() < 0.8 ? Math.floor(r() * 200) + 50 : null,
        total: r() < 0.8 ? Math.floor(r() * 220) + 60 : null,
      },
      printing: {
        variantClass: pick(
          ['HOLO', 'NON_HOLO', 'REVERSE_HOLO', 'FULL_ART', 'ALT_ART', 'GOLD'] as const,
          r,
        ),
        variantFlags:
          r() < 0.5
            ? []
            : [pick(['FIRST_EDITION', 'SHADOWLESS', 'STAMPED_PRERELEASE'] as const, r)],
        variantCode: pick(['HOLO', 'RH', 'FA', 'GOLD'], r),
        includeInMasterSet: r() < 0.85,
      },
      collection:
        r() < 0.6
          ? {
              condition: pick(['NEAR_MINT', 'LIGHTLY_PLAYED', 'MODERATELY_PLAYED'] as const, r),
              gradeCompany: r() < 0.5 ? pick(['PSA', 'BGS', 'CGC'] as const, r) : null,
              grade: r() < 0.5 ? Math.floor(r() * 11) : null,
              quantity: Math.floor(r() * 5) + 1,
              acquiredAt: r() < 0.6 ? '2024-08-01' : null,
            }
          : undefined,
    };
  }

  function genLeaf(r: () => number): Expression {
    const choices: Expression[] = [
      { type: 'eq', field: 'card.name', value: pick(['Charizard', 'Mew'], r) },
      { type: 'eq', field: 'card.rarity', value: 'HOLO_RARE' },
      { type: 'in', field: 'card.rarity', values: ['HOLO_RARE', 'ULTRA_RARE'] },
      { type: 'eq', field: 'printing.variantClass', value: 'HOLO' },
      { type: 'eq', field: 'printing.variantFlags', value: 'FIRST_EDITION' },
      {
        type: 'in',
        field: 'printing.variantFlags',
        values: ['FIRST_EDITION', 'SHADOWLESS'],
      },
      { type: 'range', field: 'card.hp', min: 100, max: 250 },
      { type: 'range', field: 'collection.grade', min: 9 },
      { type: 'range', field: 'set.releaseDate', min: '2022-01-01', max: '2024-12-31' },
      { type: 'exists', field: 'card.illustrator', exists: true },
      { type: 'exists', field: 'collection.isOwned', exists: true },
      { type: 'eq', field: 'collection.isOwned', value: true },
      { type: 'eq', field: 'printing.includeInMasterSet', value: true },
    ];
    return pick(choices, r);
  }

  function genExpression(r: () => number, depth: number): Expression {
    if (depth <= 0 || r() < 0.4) return genLeaf(r);
    const op = r();
    if (op < 0.4) {
      const n = 2 + Math.floor(r() * 2);
      return {
        type: 'and',
        children: Array.from({ length: n }, () => genExpression(r, depth - 1)),
      };
    }
    if (op < 0.75) {
      const n = 2 + Math.floor(r() * 2);
      return {
        type: 'or',
        children: Array.from({ length: n }, () => genExpression(r, depth - 1)),
      };
    }
    return { type: 'not', child: genExpression(r, depth - 1) };
  }

  it('agrees on a generated corpus of 200 (expression, item) pairs', () => {
    const r = rng(0xcafebabe);
    let mismatches = 0;
    for (let i = 0; i < 200; i++) {
      const expr = genExpression(r, 4);
      const item = genItem(r);
      const evalResult = evaluateExpression(expr, item);
      const compiled = expressionToSql(expr);
      const sqlResult = interpretSql(compiled.sql, compiled.params, item);
      if (evalResult !== sqlResult) {
        mismatches++;
        // First mismatch — useful for debugging if it ever fires.
        if (mismatches === 1) {
          console.error('mismatch', {
            expr,
            sql: compiled.sql,
            params: compiled.params,
            evalResult,
            sqlResult,
          });
        }
      }
    }
    expect(mismatches).toBe(0);
  });
});

// ============================================================
// In-process SQL interpreter — only the grammar this compiler
// emits. ~120 lines. Used exclusively by the round-trip test.
// ============================================================

const COL_ACCESSORS: Record<string, (item: CandidateItem) => unknown> = {
  'card.name': (i) => i.card.name,
  'card.number': (i) => i.card.number,
  'card.illustrator': (i) => i.card.illustrator,
  'card.language': (i) => i.card.language,
  'card.type': (i) => i.card.type,
  'card.subtype': (i) => i.card.subtype,
  'card.rarity': (i) => i.card.rarity,
  'card.hp': (i) => i.card.hp,
  'card.retreat_cost': (i) => i.card.retreatCost,
  'set.code': (i) => i.set.code,
  'set.name': (i) => i.set.name,
  'set.series': (i) => i.set.series,
  'set.language': (i) => i.set.language,
  'set.release_date': (i) => i.set.releaseDate,
  'set.printed_total': (i) => i.set.printedTotal,
  'set.total': (i) => i.set.total,
  'printing.variant_class': (i) => i.printing.variantClass,
  'printing.variant_flags': (i) => i.printing.variantFlags,
  'printing.variant_code': (i) => i.printing.variantCode,
  'printing.include_in_master_set': (i) => i.printing.includeInMasterSet,
  'collection_item.condition': (i) => i.collection?.condition ?? null,
  'collection_item.grade_company': (i) => i.collection?.gradeCompany ?? null,
  'collection_item.grade': (i) => i.collection?.grade ?? null,
  'collection_item.quantity': (i) => i.collection?.quantity ?? null,
  'collection_item.acquired_at': (i) => i.collection?.acquiredAt ?? null,
  'collection_item.id': (i) => (i.collection ? 'present' : null),
};

function tokenize(sql: string): string[] {
  const tokens: string[] = [];
  const re = /\s*(\$\d+|[A-Za-z_][A-Za-z0-9_.]*|>=|<=|=|>|<|&&|::|\(|\)|\[|\]|,)\s*/g;
  let m: RegExpExecArray | null;
  let lastIndex = 0;
  while ((m = re.exec(sql)) !== null) {
    if (m.index !== lastIndex) {
      throw new Error(`unexpected token in SQL near: ${sql.slice(m.index)}`);
    }
    tokens.push(m[1] as string);
    lastIndex = re.lastIndex;
  }
  if (lastIndex !== sql.length) {
    throw new Error(`unparsed SQL tail: ${sql.slice(lastIndex)}`);
  }
  return tokens;
}

function readCol(name: string, item: CandidateItem): unknown {
  const acc = COL_ACCESSORS[name];
  if (!acc) throw new Error(`unknown column: ${name}`);
  return acc(item);
}

function cmp(a: unknown, op: string, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  switch (op) {
    case '=':
      return (a as number | string | boolean) === b;
    case '>=':
      return (a as number | string) >= (b as number | string);
    case '<=':
      return (a as number | string) <= (b as number | string);
    case '>':
      return (a as number | string) > (b as number | string);
    case '<':
      return (a as number | string) < (b as number | string);
  }
  throw new Error(`bad op: ${op}`);
}

function interpretSql(sql: string, params: readonly unknown[], item: CandidateItem): boolean {
  const tokens = tokenize(sql);
  let pos = 0;
  const peek = (off = 0): string | undefined => tokens[pos + off];
  const consume = (expect?: string): string => {
    const tok = tokens[pos++];
    if (expect !== undefined && tok !== expect) {
      throw new Error(`expected '${expect}' at pos ${pos - 1}, got '${tok ?? '<eof>'}'`);
    }
    return tok as string;
  };
  const paramAt = (raw: string): unknown => {
    const idx = Number(raw.slice(1));
    if (!Number.isFinite(idx) || idx < 1 || idx > params.length) {
      throw new Error(`bad param ref ${raw}`);
    }
    return params[idx - 1];
  };

  function parseExpr(): boolean {
    const t = peek();
    if (t === 'TRUE') {
      consume();
      return true;
    }
    if (t === 'FALSE') {
      consume();
      return false;
    }
    consume('(');
    if (peek() === 'NOT') {
      consume();
      const v = parseExpr();
      consume(')');
      return !v;
    }
    // `$N = ANY(col)`
    const head = peek();
    if (head !== undefined && head.startsWith('$')) {
      const lv = paramAt(consume());
      consume('=');
      consume('ANY');
      consume('(');
      const col = readCol(consume(), item);
      consume(')');
      consume(')');
      return Array.isArray(col) && (col as unknown[]).includes(lv);
    }
    if (head === '(') {
      // Recurse for the first sub-expression. Then dispatch on
      // whether we're in a leaf wrapper (`IS TRUE`) or a combinator
      // series (`AND` / `OR`).
      const first = parseExpr();
      const after = peek();
      if (after === 'IS') {
        consume();
        consume('TRUE');
        consume(')');
        return first;
      }
      if (after === 'AND' || after === 'OR') {
        const op = after;
        let result = first;
        while (peek() === op) {
          consume();
          const next = parseExpr();
          result = op === 'AND' ? result && next : result || next;
        }
        consume(')');
        return result;
      }
      // Single parenthesized sub-expression — close.
      consume(')');
      return first;
    }
    // Column-headed leaf: `col IS [NOT] NULL` / `col op $N` /
    // `col IN (...)` / `col && ARRAY[...]::text[]`.
    const col = readCol(consume(), item);
    const op = peek();
    if (op === 'IS') {
      consume();
      let want = true;
      if (peek() === 'NOT') {
        consume();
        want = false;
      }
      consume('NULL');
      consume(')');
      const isNull = col === null || col === undefined;
      return want ? isNull : !isNull;
    }
    if (op === '=' || op === '>=' || op === '<=' || op === '>' || op === '<') {
      consume();
      const param = paramAt(consume());
      consume(')');
      return cmp(col, op, param);
    }
    if (op === 'IN') {
      consume();
      consume('(');
      const vals: unknown[] = [];
      while (true) {
        const next = consume();
        if (!next.startsWith('$')) throw new Error('expected $N in IN');
        vals.push(paramAt(next));
        if (peek() === ',') {
          consume();
          continue;
        }
        break;
      }
      consume(')');
      consume(')');
      return vals.some((v) => v === col);
    }
    if (op === '&&') {
      consume();
      consume('ARRAY');
      consume('[');
      const vals: unknown[] = [];
      while (true) {
        const next = consume();
        if (!next.startsWith('$')) throw new Error('expected $N in ARRAY');
        vals.push(paramAt(next));
        if (peek() === ',') {
          consume();
          continue;
        }
        break;
      }
      consume(']');
      consume('::');
      consume('text');
      consume('[');
      consume(']');
      consume(')');
      if (!Array.isArray(col)) return false;
      return (col as unknown[]).some((c) => vals.includes(c));
    }
    throw new Error(`unsupported op after column: ${String(op)}`);
  }

  const result = parseExpr();
  if (pos !== tokens.length) {
    throw new Error(`unparsed tokens remain: ${tokens.slice(pos).join(' ')}`);
  }
  return result;
}
