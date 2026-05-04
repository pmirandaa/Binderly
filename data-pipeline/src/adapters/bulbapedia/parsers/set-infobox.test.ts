// Typed SetInfobox parser tests.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseReleaseDate, parseSetInfobox } from './set-infobox.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES = path.join(__dirname, '..', 'fixtures');

function loadWikitext(name: string): string {
  return readFileSync(path.join(FIXTURES, name), 'utf8');
}

describe('parseSetInfobox', () => {
  it('parses Base Set', () => {
    const parsed = parseSetInfobox('Base Set (TCG)', loadWikitext('wikitext.set-base-set.txt'));
    expect(parsed.name).toBe('Base Set');
    expect(parsed.series).toBe('Original');
    expect(parsed.releaseDate).toBe('1999-01-09');
    expect(parsed.printedTotal).toBe(102);
    expect(parsed.total).toBe(102);
    expect(parsed.japaneseName).toBe('拡張パック 第1弾');
  });

  it('parses Brilliant Stars', () => {
    const parsed = parseSetInfobox(
      'Brilliant Stars (TCG)',
      loadWikitext('wikitext.set-brilliant-stars.txt'),
    );
    expect(parsed.name).toBe('Brilliant Stars');
    expect(parsed.series).toBe('Sword & Shield');
    expect(parsed.releaseDate).toBe('2022-02-25');
    expect(parsed.printedTotal).toBe(172);
    expect(parsed.total).toBe(216);
  });

  it('parses SWSH Black Star Promos (no cardstotal → falls back to cards)', () => {
    const parsed = parseSetInfobox(
      'SWSH Black Star Promos (TCG)',
      loadWikitext('wikitext.set-swsh-promos.txt'),
    );
    expect(parsed.name).toBe('SWSH Black Star Promos');
    expect(parsed.releaseDate).toBe('2019-11-15');
    expect(parsed.printedTotal).toBe(313);
    expect(parsed.total).toBe(313);
  });
});

describe('parseReleaseDate', () => {
  it('parses US format with full month name', () => {
    expect(parseReleaseDate('February 25, 2022')).toBe('2022-02-25');
  });

  it('parses US format with abbreviated month', () => {
    expect(parseReleaseDate('Feb 25, 2022')).toBe('2022-02-25');
  });

  it('parses DMY format', () => {
    expect(parseReleaseDate('25 February 2022')).toBe('2022-02-25');
  });

  it('passes ISO through', () => {
    expect(parseReleaseDate('2022-02-25')).toBe('2022-02-25');
  });

  it('returns null on garbage', () => {
    expect(parseReleaseDate('soon')).toBeNull();
  });
});
