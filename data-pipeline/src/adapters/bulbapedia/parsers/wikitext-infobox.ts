// Standalone wikitext infobox parser. Pure string operations — no
// dependencies, no DOM, no regex backtracking pitfalls. Tuned for
// Bulbapedia's `{{TemplateName|param=value|…}}` style; not a full
// MediaWiki parser.
//
// What this parser handles correctly:
//
//   - Top-level `{{Template|…}}` blocks at any nesting depth in the
//     page's wikitext.
//   - Nested templates inside parameter values (counted by brace
//     depth, NOT regex). Example:
//     `{{CardInfobox|caption=Illus. {{tt|Mitsuhiro Arita|the artist}}|…}}`
//   - Wikilinks `[[Page]]` / `[[Page|alt]]` inside values (the link
//     pipe doesn't terminate a parameter because it's inside `[[…]]`).
//   - Multi-line values (parameters separated by `|` at the start of
//     a line are normalized).
//   - Italics `''text''` and bold `'''text'''` stripped via helpers.
//   - HTML comments `<!-- … -->` stripped before parsing.
//
// What this parser DOES NOT handle (intentionally):
//
//   - `{{#switch}}` / `{{#if}}` parser functions: we strip them as
//     opaque substitutions when encountered inside a parameter value
//     (they collapse to empty); we do not re-evaluate.
//   - Tables / lists: irrelevant for infobox extraction.
//   - Templates whose names contain `|` (none in Bulbapedia's TCG
//     templates).

import type { ParsedTemplateBlock } from '../wiki-types.js';

/**
 * Find every top-level `{{Template|…}}` block in the wikitext and
 * return them as `(name, params)` pairs in document order.
 *
 * "Top-level" here means: the parser walks the string once, and for
 * each `{{` opener it consumes a balanced block (counting `{{` /
 * `}}` to handle nested templates). When it finds a top-level
 * block, the block is added to the output; when it finds a nested
 * one inside a parameter value, the wikitext is preserved verbatim
 * in the parameter's value but no separate output entry is created.
 */
export function parseTemplateBlocks(wikitext: string): ParsedTemplateBlock[] {
  const cleaned = stripHtmlComments(wikitext);
  const blocks: ParsedTemplateBlock[] = [];
  const len = cleaned.length;
  let i = 0;
  while (i < len) {
    if (cleaned[i] === '{' && cleaned[i + 1] === '{') {
      const end = findBalancedTemplateEnd(cleaned, i);
      if (end === -1) {
        // Unbalanced — bail rather than infinite-loop. Mirrors the
        // `{{` open without a matching close: we move past one char.
        i += 1;
        continue;
      }
      const block = cleaned.slice(i + 2, end - 2);
      const parsed = parseInfoboxBlock(block);
      if (parsed.name) blocks.push(parsed);
      i = end;
      continue;
    }
    i += 1;
  }
  return blocks;
}

/**
 * Parse the raw inner body of a `{{Template|…}}` block (the bytes
 * between the opening `{{` and closing `}}`) into a typed record.
 *
 * The first `|`-separated segment is the template name; the rest
 * are params (`key=value` or positional `value`). Positional params
 * are surfaced under numeric keys (`1`, `2`, …) so callers can find
 * them when needed.
 */
export function parseInfoboxBlock(block: string): ParsedTemplateBlock {
  const segments = splitTopLevelByPipe(block);
  const name = (segments[0] ?? '').trim();
  const params: Record<string, string> = {};
  let positional = 0;
  for (let s = 1; s < segments.length; s += 1) {
    const segment = segments[s];
    if (segment === undefined) continue;
    const eqIdx = findTopLevelEquals(segment);
    if (eqIdx === -1) {
      positional += 1;
      params[String(positional)] = segment.trim();
    } else {
      const key = segment.slice(0, eqIdx).trim();
      const value = segment.slice(eqIdx + 1).trim();
      if (key) params[key] = value;
    }
  }
  return { name, params };
}

/**
 * Split a template body on top-level `|`. Pipes inside `[[…]]`
 * wikilinks or nested `{{…}}` templates are preserved.
 */
export function splitTopLevelByPipe(body: string): string[] {
  const out: string[] = [];
  let depthCurly = 0;
  let depthBracket = 0;
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    const next = body[i + 1];
    if (c === '{' && next === '{') {
      depthCurly += 1;
      i += 1;
      continue;
    }
    if (c === '}' && next === '}') {
      depthCurly = Math.max(0, depthCurly - 1);
      i += 1;
      continue;
    }
    if (c === '[' && next === '[') {
      depthBracket += 1;
      i += 1;
      continue;
    }
    if (c === ']' && next === ']') {
      depthBracket = Math.max(0, depthBracket - 1);
      i += 1;
      continue;
    }
    if (c === '|' && depthCurly === 0 && depthBracket === 0) {
      out.push(body.slice(start, i));
      start = i + 1;
    }
  }
  out.push(body.slice(start));
  return out;
}

/**
 * Find the index of the first top-level `=` in a parameter segment.
 * Equals signs inside wikilinks / nested templates do not terminate
 * the key.
 */
export function findTopLevelEquals(segment: string): number {
  let depthCurly = 0;
  let depthBracket = 0;
  for (let i = 0; i < segment.length; i += 1) {
    const c = segment[i];
    const next = segment[i + 1];
    if (c === '{' && next === '{') {
      depthCurly += 1;
      i += 1;
      continue;
    }
    if (c === '}' && next === '}') {
      depthCurly = Math.max(0, depthCurly - 1);
      i += 1;
      continue;
    }
    if (c === '[' && next === '[') {
      depthBracket += 1;
      i += 1;
      continue;
    }
    if (c === ']' && next === ']') {
      depthBracket = Math.max(0, depthBracket - 1);
      i += 1;
      continue;
    }
    if (c === '=' && depthCurly === 0 && depthBracket === 0) return i;
  }
  return -1;
}

/**
 * Locate the position immediately AFTER the closing `}}` of the
 * `{{` block at `start`. Returns `-1` when no balanced close exists.
 */
export function findBalancedTemplateEnd(text: string, start: number): number {
  if (text[start] !== '{' || text[start + 1] !== '{') return -1;
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '{' && next === '{') {
      depth += 1;
      i += 2;
      continue;
    }
    if (c === '}' && next === '}') {
      depth -= 1;
      i += 2;
      if (depth === 0) return i;
      continue;
    }
    i += 1;
  }
  return -1;
}

/**
 * Convert a wikitext value to plain text suitable for storage:
 *
 *   - `[[Foo|Bar]]` → `Bar`
 *   - `[[Foo]]` → `Foo`
 *   - `'''bold'''` / `''italics''` → `bold` / `italics`
 *   - `<br>` / `<br />` → space
 *   - HTML tags around the body are NOT stripped (we don't expect
 *     them in the values we read).
 */
export function stripWikitextLinks(value: string): string {
  let out = value;
  // Wikilinks. Iterative so nested cases (rare in our slice) are
  // handled.
  for (let i = 0; i < 5; i += 1) {
    const before = out;
    out = out.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2');
    out = out.replace(/\[\[([^\]]+)\]\]/g, '$1');
    if (out === before) break;
  }
  // External links: `[https://example.com label]` → `label`. The
  // label-less form `[https://example.com]` collapses to empty.
  out = out.replace(/\[(https?:[^\]\s]+)\s+([^\]]+)\]/g, '$2');
  out = out.replace(/\[(https?:[^\]\s]+)\]/g, '');
  return out;
}

/** `'''bold'''` and `''italics''` → bare text. Preserves order so
 *  the bold pattern fires before italics (otherwise italic would
 *  swallow one tick). */
export function unwrapWikitextItalics(value: string): string {
  return value.replace(/'''([^']+)'''/g, '$1').replace(/''([^']+)''/g, '$1');
}

/** Replace HTML line breaks with a space and collapse runs of whitespace. */
export function normalizeWhitespace(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip HTML comments before any other parsing. */
export function stripHtmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * Convenience: collapse a wikitext value to a plain trimmed string
 * suitable for downstream `Raw*` slot writes. Combines the link /
 * italic / whitespace helpers above.
 */
export function flattenWikitextValue(value: string): string {
  return normalizeWhitespace(unwrapWikitextItalics(stripWikitextLinks(value)));
}
