// Unit tests for the wikitext infobox parser. Pure string operations
// — no fixtures needed here; the bigger fixture-driven coverage
// lives in transform.test.ts and adapter.test.ts.

import { describe, expect, it } from 'vitest';

import {
  findBalancedTemplateEnd,
  findTopLevelEquals,
  flattenWikitextValue,
  normalizeWhitespace,
  parseInfoboxBlock,
  parseTemplateBlocks,
  splitTopLevelByPipe,
  stripHtmlComments,
  stripWikitextLinks,
  unwrapWikitextItalics,
} from './wikitext-infobox.js';

describe('parseTemplateBlocks', () => {
  it('extracts a single top-level template', () => {
    const blocks = parseTemplateBlocks('{{CardInfobox|cardname=Charizard|hp=120}}');
    expect(blocks).toEqual([{ name: 'CardInfobox', params: { cardname: 'Charizard', hp: '120' } }]);
  });

  it('handles multi-line params with explicit `\\n|key=value`', () => {
    const wt = '{{CardInfobox\n|cardname=Charizard\n|hp=120\n}}';
    const blocks = parseTemplateBlocks(wt);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.params).toEqual({ cardname: 'Charizard', hp: '120' });
  });

  it('returns blocks in document order across multiple top-level templates', () => {
    const wt = '{{One|a=1}}\n\nIntro text\n\n{{Two|b=2}}\n\n{{Three|c=3}}';
    const blocks = parseTemplateBlocks(wt);
    expect(blocks.map((b) => b.name)).toEqual(['One', 'Two', 'Three']);
  });

  it('preserves nested templates verbatim inside a parameter value', () => {
    // The {{tt}} nested template lives inside `caption`. We do NOT
    // re-emit it as a separate top-level block.
    const wt =
      '{{CardInfobox|cardname=Charizard|caption=Illus. {{tt|Mitsuhiro Arita|the artist}}}}';
    const blocks = parseTemplateBlocks(wt);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.name).toBe('CardInfobox');
    expect(blocks[0]?.params['caption']).toBe('Illus. {{tt|Mitsuhiro Arita|the artist}}');
  });

  it('preserves wikilinks `[[Page|Alt]]` inside parameter values without splitting on the pipe', () => {
    const wt = '{{CardInfobox|cardname=[[Charizard|Charizard (Pokémon)]]}}';
    const blocks = parseTemplateBlocks(wt);
    expect(blocks[0]?.params['cardname']).toBe('[[Charizard|Charizard (Pokémon)]]');
  });

  it('strips HTML comments before parsing', () => {
    const wt = '<!-- a comment -->{{Infobox|x=1}}<!-- another -->';
    const blocks = parseTemplateBlocks(wt);
    expect(blocks).toEqual([{ name: 'Infobox', params: { x: '1' } }]);
  });

  it('handles unbalanced openers without infinite-looping', () => {
    const wt = '{{Broken|hp=100\n\nTrailing text';
    const blocks = parseTemplateBlocks(wt);
    expect(blocks).toEqual([]);
  });

  it('returns positional params for templates that use them', () => {
    const wt = '{{Stub|reason text|2024}}';
    const blocks = parseTemplateBlocks(wt);
    expect(blocks[0]?.params).toEqual({ '1': 'reason text', '2': '2024' });
  });
});

describe('parseInfoboxBlock', () => {
  it('returns empty params for nameless body', () => {
    expect(parseInfoboxBlock('')).toEqual({ name: '', params: {} });
  });

  it('reads a positional + named mix', () => {
    const block = parseInfoboxBlock('Foo|positional|key=value');
    expect(block).toEqual({ name: 'Foo', params: { '1': 'positional', key: 'value' } });
  });
});

describe('splitTopLevelByPipe', () => {
  it('splits trivial pipes', () => {
    expect(splitTopLevelByPipe('a|b|c')).toEqual(['a', 'b', 'c']);
  });

  it('keeps wikilink pipes intact', () => {
    expect(splitTopLevelByPipe('a|[[Foo|Bar]]|c')).toEqual(['a', '[[Foo|Bar]]', 'c']);
  });

  it('keeps nested template pipes intact', () => {
    expect(splitTopLevelByPipe('a|{{tt|x|y}}|c')).toEqual(['a', '{{tt|x|y}}', 'c']);
  });
});

describe('findTopLevelEquals', () => {
  it('finds the first top-level `=`', () => {
    expect(findTopLevelEquals('key=value')).toBe(3);
  });

  it('skips equals inside wikilinks', () => {
    expect(findTopLevelEquals('caption=Illus. [[Mitsuhiro Arita|signature=true]]')).toBe(7);
  });

  it('returns -1 when there is no top-level equals', () => {
    expect(findTopLevelEquals('positional value')).toBe(-1);
  });
});

describe('findBalancedTemplateEnd', () => {
  it('returns the index after `}}` on a balanced block', () => {
    const wt = '{{Foo}}';
    expect(findBalancedTemplateEnd(wt, 0)).toBe(7);
  });

  it('handles nested templates', () => {
    const wt = '{{Outer|x={{Inner|y=1}}}}';
    expect(findBalancedTemplateEnd(wt, 0)).toBe(wt.length);
  });

  it('returns -1 when no balanced close exists', () => {
    expect(findBalancedTemplateEnd('{{Foo|', 0)).toBe(-1);
  });

  it('returns -1 when the start does not point at `{{`', () => {
    expect(findBalancedTemplateEnd('text {{Foo}}', 0)).toBe(-1);
  });
});

describe('text helpers', () => {
  it('strips wikilinks down to display text', () => {
    expect(stripWikitextLinks('[[Mitsuhiro Arita]]')).toBe('Mitsuhiro Arita');
    expect(stripWikitextLinks('[[Mitsuhiro Arita|M. Arita]]')).toBe('M. Arita');
  });

  it('strips external links with labels', () => {
    expect(stripWikitextLinks('[https://example.com Example]')).toBe('Example');
    expect(stripWikitextLinks('[https://example.com]')).toBe('');
  });

  it('unwraps bold and italics', () => {
    expect(unwrapWikitextItalics(`'''bold''' and ''italics''`)).toBe('bold and italics');
  });

  it('normalizes whitespace and `<br>` tags', () => {
    expect(normalizeWhitespace('a  b<br>c<br />d  ')).toBe('a b c d');
  });

  it('strips HTML comments', () => {
    expect(stripHtmlComments('a<!-- x -->b')).toBe('ab');
  });

  it('flattenWikitextValue composes the helpers', () => {
    expect(flattenWikitextValue(`Illus. ''[[Mitsuhiro Arita]]''<br />signature`)).toBe(
      'Illus. Mitsuhiro Arita signature',
    );
  });
});
