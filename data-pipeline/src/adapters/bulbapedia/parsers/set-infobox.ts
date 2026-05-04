// Typed `SetInfobox` parser. Reads the wikitext yielded by
// `parseTemplateBlocks` and returns a `ParsedSet` with normalized
// fields.

import { flattenWikitextValue, parseTemplateBlocks } from './wikitext-infobox.js';

import type { ParsedSet } from '../wiki-types.js';

const SET_INFOBOX_NAMES = new Set(['SetInfobox', 'TCGSetInfobox', 'Expansion', 'TCGExpansion']);

/**
 * Parse a set page's wikitext into a `ParsedSet`.
 */
export function parseSetInfobox(pageTitle: string, wikitext: string): ParsedSet {
  const blocks = parseTemplateBlocks(wikitext);
  const infobox = blocks.find((b) => SET_INFOBOX_NAMES.has(b.name));

  const out: ParsedSet = { pageTitle };
  if (!infobox) return out;
  const p = infobox.params;

  const name = pickFlat(p, 'name', 'setname');
  if (name) out.name = name;
  const series = pickFlat(p, 'series', 'era', 'block');
  if (series) out.series = series;
  const released = pickFlat(p, 'released', 'releasedate', 'usrelease', 'enrelease');
  if (released) {
    const iso = parseReleaseDate(released);
    if (iso) out.releaseDate = iso;
  }
  const printed = parseIntStrict(pickFlat(p, 'cards', 'printedTotal'));
  if (printed != null) out.printedTotal = printed;
  const total = parseIntStrict(pickFlat(p, 'cardstotal', 'total'));
  if (total != null) out.total = total;
  else if (printed != null) out.total = printed;
  const jname = pickFlat(p, 'jname', 'jpname');
  if (jname) out.japaneseName = jname;

  return out;
}

// ============================================================
// Helpers
// ============================================================

function pickFlat(p: Record<string, string>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const raw = p[k];
    if (raw == null) continue;
    const flat = flattenWikitextValue(raw);
    if (flat) return flat;
  }
  return undefined;
}

function parseIntStrict(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const m = value.match(/^-?\d+/);
  if (!m) return undefined;
  const n = Number.parseInt(m[0], 10);
  return Number.isFinite(n) ? n : undefined;
}

const MONTHS: Readonly<Record<string, string>> = {
  january: '01',
  february: '02',
  march: '03',
  april: '04',
  may: '05',
  june: '06',
  july: '07',
  august: '08',
  september: '09',
  october: '10',
  november: '11',
  december: '12',
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  sept: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};

/**
 * Parse a Bulbapedia release-date string to ISO `yyyy-mm-dd`.
 *
 * Accepted forms:
 *   - `February 25, 2022`
 *   - `Feb 25, 2022`
 *   - `25 February 2022`
 *   - `2022-02-25`
 */
export function parseReleaseDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  // ISO already.
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  // `February 25, 2022` / `Feb 25, 2022`
  const usMatch = trimmed.match(/^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (usMatch) {
    const month = MONTHS[usMatch[1]!.toLowerCase()];
    if (!month) return null;
    const day = String(usMatch[2]).padStart(2, '0');
    return `${usMatch[3]}-${month}-${day}`;
  }
  // `25 February 2022`
  const dmyMatch = trimmed.match(/^(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{4})/);
  if (dmyMatch) {
    const month = MONTHS[dmyMatch[2]!.toLowerCase()];
    if (!month) return null;
    const day = String(dmyMatch[1]).padStart(2, '0');
    return `${dmyMatch[3]}-${month}-${day}`;
  }
  return null;
}
