// Set-name dictionary used by the set-number pass.
//
// Keyed by the *lowercased* form a seller is most likely to type in
// the listing title. Values are the canonical TCGdex-style codes
// (`'swsh9'`, `'sv1'`, `'base1'`) that `canonicalSetKey()` accepts.
//
// Coverage priorities (per AC):
//   - Modern era (Sword & Shield + Scarlet & Violet) — comprehensive.
//   - Vintage (Base, Jungle, Fossil, Team Rocket, Gym, Neo) — covered.
//   - Mid-era (EX, DP, HGSS, BW, XY, SM) — selective.
//
// The dictionary is a `Map` so iteration order is stable for
// debugging. Entries are added with the most descriptive key first
// (e.g. `team rocket returns` before `team rocket`) — but the
// caller's longest-match-wins logic resolves ambiguities anyway.

const ENTRIES: ReadonlyArray<readonly [string, string]> = [
  // Vintage WoTC
  ['base set 2', 'base2'],
  ['base set', 'base1'],
  ['base 2', 'base2'],
  ['jungle', 'base2-or-jungle-jungle'],
  ['fossil', 'fossil'],
  ['team rocket returns', 'ex7'],
  ['team rocket', 'rocket'],
  ['gym heroes', 'gym1'],
  ['gym challenge', 'gym2'],
  ['neo genesis', 'neo1'],
  ['neo discovery', 'neo2'],
  ['neo destiny', 'neo4'],
  ['neo revelation', 'neo3'],
  ['legendary collection', 'base6'],
  // E-Card
  ['expedition', 'ecard1'],
  ['aquapolis', 'ecard2'],
  ['skyridge', 'ecard3'],
  // EX series
  ['ruby and sapphire', 'ex1'],
  ['sandstorm', 'ex2'],
  ['dragon frontiers', 'ex15'],
  ['hidden legends', 'ex5'],
  ['firered leafgreen', 'ex6'],
  ['emerald', 'ex8'],
  ['unseen forces', 'ex9'],
  ['delta species', 'ex10'],
  ['legend maker', 'ex11'],
  ['holon phantoms', 'ex12'],
  ['crystal guardians', 'ex13'],
  ['dragon frontiers', 'ex15'],
  ['power keepers', 'ex16'],
  // DP / Platinum
  ['diamond and pearl', 'dp1'],
  ['mysterious treasures', 'dp2'],
  ['secret wonders', 'dp3'],
  ['great encounters', 'dp4'],
  ['majestic dawn', 'dp5'],
  ['legends awakened', 'dp6'],
  ['stormfront', 'dp7'],
  ['platinum', 'pl1'],
  ['rising rivals', 'pl2'],
  ['supreme victors', 'pl3'],
  ['arceus', 'pl4'],
  // HGSS
  ['heartgold soulsilver', 'hgss1'],
  ['unleashed', 'hgss2'],
  ['undaunted', 'hgss3'],
  ['triumphant', 'hgss4'],
  ['call of legends', 'col1'],
  // BW
  ['black and white', 'bw1'],
  ['emerging powers', 'bw2'],
  ['noble victories', 'bw3'],
  ['next destinies', 'bw4'],
  ['dark explorers', 'bw5'],
  ['dragons exalted', 'bw6'],
  ['boundaries crossed', 'bw7'],
  ['plasma storm', 'bw8'],
  ['plasma freeze', 'bw9'],
  ['plasma blast', 'bw10'],
  ['legendary treasures', 'bw11'],
  // XY
  ['kalos starter', 'xyp'],
  ['flashfire', 'xy2'],
  ['furious fists', 'xy3'],
  ['phantom forces', 'xy4'],
  ['primal clash', 'xy5'],
  ['roaring skies', 'xy6'],
  ['ancient origins', 'xy7'],
  ['breakthrough', 'xy8'],
  ['breakpoint', 'xy9'],
  ['fates collide', 'xy10'],
  ['steam siege', 'xy11'],
  ['evolutions', 'xy12'],
  ['generations', 'g1'],
  // SM
  ['sun and moon', 'sm1'],
  ['guardians rising', 'sm2'],
  ['burning shadows', 'sm3'],
  ['shining legends', 'sm35'],
  ['crimson invasion', 'sm4'],
  ['ultra prism', 'sm5'],
  ['forbidden light', 'sm6'],
  ['celestial storm', 'sm7'],
  ['lost thunder', 'sm8'],
  ['team up', 'sm9'],
  ['detective pikachu', 'det1'],
  ['unbroken bonds', 'sm10'],
  ['unified minds', 'sm11'],
  ['hidden fates', 'sm115'],
  ['cosmic eclipse', 'sm12'],
  // SWSH
  ['sword and shield', 'swsh1'],
  ['rebel clash', 'swsh2'],
  ['darkness ablaze', 'swsh3'],
  ['champions path', 'swsh35'],
  ['vivid voltage', 'swsh4'],
  ['shining fates', 'swsh45'],
  ['battle styles', 'swsh5'],
  ['chilling reign', 'swsh6'],
  ['evolving skies', 'swsh7'],
  ['celebrations', 'swsh45sv'],
  ['fusion strike', 'swsh8'],
  ['brilliant stars', 'swsh9'],
  ['astral radiance', 'swsh10'],
  ['pokemon go', 'pgo'],
  ['lost origin', 'swsh11'],
  ['silver tempest', 'swsh12'],
  ['crown zenith', 'swsh125'],
  // SV
  ['scarlet and violet', 'sv1'],
  ['scarlet violet', 'sv1'],
  ['paldea evolved', 'sv2'],
  ['obsidian flames', 'sv3'],
  ['151', 'sv35'],
  ['pokemon 151', 'sv35'],
  ['paradox rift', 'sv4'],
  ['paldean fates', 'sv4pt5'],
  ['temporal forces', 'sv5'],
  ['twilight masquerade', 'sv6'],
  ['shrouded fable', 'sv6pt5'],
  ['stellar crown', 'sv7'],
  ['surging sparks', 'sv8'],
  ['prismatic evolutions', 'sv8pt5'],
  ['journey together', 'sv9'],
  ['destined rivals', 'sv10'],
  ['black bolt', 'sv11blk'],
  ['white flare', 'sv11wht'],
  ['mega evolution', 'sv12'],
  // Promo umbrellas
  ['black star promo', 'swshp'],
  ['black star promos', 'swshp'],
  ['wizards black star', 'basep'],
];

export const SET_NAME_TO_CODE: ReadonlyMap<string, string> = new Map(ENTRIES);

/**
 * Look up the canonical set code for a known set name. Returns
 * `null` if the name is not in the dictionary.
 */
export function lookupSetCodeByName(name: string): string | null {
  const v = name.trim().toLowerCase();
  return SET_NAME_TO_CODE.get(v) ?? null;
}
