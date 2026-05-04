// Typed CardInfobox parser tests. We assert the typed `ParsedCard`
// fields the transform layer consumes; full Raw* round-trip coverage
// is in `transform.test.ts`.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseCardInfobox } from './card-infobox.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES = path.join(__dirname, '..', 'fixtures');

function loadWikitext(name: string): string {
  return readFileSync(path.join(FIXTURES, name), 'utf8');
}

describe('parseCardInfobox', () => {
  it('parses Base Set Charizard with explicit per-print sub-templates', () => {
    const wt = loadWikitext('wikitext.charizard-base-set-4.txt');
    const parsed = parseCardInfobox('Charizard (Base Set 4)', wt);
    expect(parsed.pageTitle).toBe('Charizard (Base Set 4)');
    expect(parsed.name).toBe('Charizard');
    expect(parsed.setName).toBe('Base Set');
    expect(parsed.number).toBe('4');
    expect(parsed.cardnoRaw).toBe('4/102');
    expect(parsed.type).toBe('Fire');
    expect(parsed.hp).toBe(120);
    expect(parsed.retreatCost).toBe(3);
    expect(parsed.illustrator).toBe('Mitsuhiro Arita');
    expect(parsed.rarity).toBe('Holo Rare');
    expect(parsed.class).toBe('Holographic');
    expect(parsed.species).toBe('Charizard');
    expect(parsed.evostage).toBe('Stage 2');
    expect(parsed.evolveFrom).toBe('Charmeleon');
    expect(parsed.japaneseName).toBe('リザードン');
    expect(parsed.printings).toHaveLength(3);
    expect(parsed.printings?.[0]).toMatchObject({
      label: '1st Edition Shadowless Holo',
      class: 'Holographic',
      isFirstEdition: true,
      isShadowless: true,
    });
    expect(parsed.printings?.[1]).toMatchObject({
      label: 'Shadowless Holo',
      isShadowless: true,
    });
    expect(parsed.printings?.[2]).toMatchObject({
      label: 'Unlimited Holo',
      isUnlimited: true,
    });
  });

  it('parses Brilliant Stars Charizard VSTAR Rainbow with single dominant infobox', () => {
    const wt = loadWikitext('wikitext.charizard-vstar-rainbow.txt');
    const parsed = parseCardInfobox('Charizard VSTAR (Brilliant Stars 174)', wt);
    expect(parsed.name).toBe('Charizard VSTAR');
    expect(parsed.setName).toBe('Brilliant Stars');
    expect(parsed.number).toBe('174');
    expect(parsed.cardnoRaw).toBe('174/172');
    expect(parsed.hp).toBe(280);
    expect(parsed.class).toBe('Rainbow Rare');
    expect(parsed.rarity).toBe('Rare Rainbow');
    expect(parsed.regulationMark).toBe('F');
    expect(parsed.printings).toBeUndefined();
  });

  it('parses Lugia V Staff Promo with stamp signal', () => {
    const wt = loadWikitext('wikitext.lugia-staff-promo.txt');
    const parsed = parseCardInfobox('Lugia V (SWSH Black Star Promos 285)', wt);
    expect(parsed.name).toBe('Lugia V');
    expect(parsed.setName).toBe('SWSH Black Star Promos');
    expect(parsed.number).toBe('SWSH285');
    expect(parsed.rarity).toBe('Promo');
    expect(parsed.stamp).toBe('STAFF');
  });

  it('falls back to caption when illus param is missing', () => {
    const wt =
      '{{CardInfobox|cardname=Foo|caption=Illus. [[Mitsuhiro Arita]]|expansion=Test|cardno=1/100}}';
    const parsed = parseCardInfobox('Foo (Test 1)', wt);
    expect(parsed.illustrator).toBe('Mitsuhiro Arita');
  });

  it('parses retreat cost `-` as 0 (free retreat)', () => {
    const wt = '{{CardInfobox|cardname=Foo|retreatcost=-|expansion=Test|cardno=1/100}}';
    const parsed = parseCardInfobox('Foo (Test 1)', wt);
    expect(parsed.retreatCost).toBe(0);
  });

  it('expands single-letter type abbreviations', () => {
    for (const [abbr, full] of [
      ['G', 'Grass'],
      ['R', 'Fire'],
      ['W', 'Water'],
      ['L', 'Lightning'],
      ['P', 'Psychic'],
      ['F', 'Fighting'],
      ['D', 'Darkness'],
      ['M', 'Metal'],
      ['Y', 'Fairy'],
      ['N', 'Dragon'],
      ['C', 'Colorless'],
    ]) {
      const wt = `{{CardInfobox|cardname=Foo|type=${abbr}|expansion=Test|cardno=1/100}}`;
      const parsed = parseCardInfobox('Foo (Test 1)', wt);
      expect(parsed.type).toBe(full);
    }
  });
});
