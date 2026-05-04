// Hand-crafted eBay listing-title corpus.
//
// 100+ titles synthesised from public listing patterns documented in
// `PROJECT.md` § 13 and the parser author's domain knowledge. NO
// live eBay scraping — every title here is a representative pattern,
// not a real listing.
//
// Each entry carries an `expected` partial of `ParsedListing` against
// which `parse.test.ts` asserts via `expect.objectContaining`. The
// `category` field segments the corpus for the confidence-
// calibration test (`confidence.test.ts`).

import type { Condition, GradeCompany, GradeTier, ListingLanguage, RarityHint } from './types.js';

export type CorpusCategory =
  | 'psa-slab'
  | 'bgs-slab'
  | 'cgc-slab'
  | 'other-slab'
  | 'raw-nm'
  | 'raw-played'
  | 'lot'
  | 'jp'
  | 'variant'
  | 'subset-numbered'
  | 'pokemon-center'
  | 'pathological';

export interface CorpusExpectations {
  readonly grading?: {
    readonly company?: GradeCompany | null;
    readonly grade?: number | null;
    readonly isSlab?: boolean;
    readonly gradeTier?: GradeTier | null;
  };
  readonly condition?: Condition | null;
  readonly language?: ListingLanguage;
  readonly setCode?: string | null;
  readonly setName?: string | null;
  readonly cardNumber?: string | null;
  readonly cardName?: string | null;
  readonly variants?: {
    readonly isHolo?: boolean | null;
    readonly isReverseHolo?: boolean | null;
    readonly isFirstEdition?: boolean | null;
    readonly isShadowless?: boolean | null;
    readonly isFullArt?: boolean | null;
    readonly isAltArt?: boolean | null;
    readonly isPromo?: boolean | null;
    readonly isRainbow?: boolean | null;
    readonly isGold?: boolean | null;
    readonly isSecretRare?: boolean | null;
    readonly isStaff?: boolean | null;
    readonly isPrerelease?: boolean | null;
    readonly isPokeBallPattern?: boolean | null;
    readonly isMasterBallPattern?: boolean | null;
    readonly rarityHint?: RarityHint | null;
  };
  readonly isLot?: boolean;
  readonly lotSize?: number | null;
  readonly minConfidence?: number;
}

export interface CorpusEntry {
  readonly title: string;
  readonly category: CorpusCategory;
  readonly expected: CorpusExpectations;
}

export const CORPUS: readonly CorpusEntry[] = [
  // ============================================================
  // PSA-graded slabs (18 entries)
  // ============================================================
  {
    title: 'PSA 10 GEM MINT Charizard 4/102 Base Set 1999 Holo Rare',
    category: 'psa-slab',
    expected: {
      grading: { company: 'PSA', grade: 10, isSlab: true, gradeTier: 'PSA_10' },
      cardNumber: '4',
      cardName: 'charizard',
      setCode: 'base1',
      variants: { isHolo: true },
      isLot: false,
      minConfidence: 0.7,
    },
  },
  {
    title: 'PSA 9 MINT Pikachu 58/102 Base Set Shadowless Holo',
    category: 'psa-slab',
    expected: {
      grading: { company: 'PSA', grade: 9, isSlab: true, gradeTier: 'PSA_9' },
      cardNumber: '58',
      cardName: 'pikachu',
      setCode: 'base1',
      variants: { isHolo: true, isShadowless: true },
      minConfidence: 0.7,
    },
  },
  {
    title: 'PSA 10 Blastoise 2/102 Base Set Holo Rare 1999',
    category: 'psa-slab',
    expected: {
      grading: { company: 'PSA', grade: 10, isSlab: true, gradeTier: 'PSA_10' },
      cardNumber: '2',
      cardName: 'blastoise',
      setCode: 'base1',
      variants: { isHolo: true },
      minConfidence: 0.7,
    },
  },
  {
    title: 'PSA 8 NM-MT Venusaur 15/102 Base Set Holo',
    category: 'psa-slab',
    expected: {
      grading: { company: 'PSA', grade: 8, isSlab: true, gradeTier: 'PSA_8' },
      cardNumber: '15',
      cardName: 'venusaur',
      setCode: 'base1',
      minConfidence: 0.7,
    },
  },
  {
    title: 'PSA 7 NM Mewtwo 10/102 Base Set Holo Rare',
    category: 'psa-slab',
    expected: {
      grading: { company: 'PSA', grade: 7, isSlab: true, gradeTier: 'PSA_7' },
      cardNumber: '10',
      cardName: 'mewtwo',
      minConfidence: 0.7,
    },
  },
  {
    title: 'PSA 10 Umbreon VMAX 215/203 Evolving Skies Alt Art',
    category: 'psa-slab',
    expected: {
      grading: { company: 'PSA', grade: 10, isSlab: true, gradeTier: 'PSA_10' },
      cardNumber: '215',
      cardName: 'umbreon',
      setCode: 'swsh7',
      variants: { isAltArt: true, rarityHint: 'VMAX' },
      minConfidence: 0.7,
    },
  },
  {
    title: 'PSA 10 Sylveon V Alt Art 091/069 Evolving Skies',
    category: 'psa-slab',
    expected: {
      grading: { company: 'PSA', grade: 10, isSlab: true, gradeTier: 'PSA_10' },
      cardNumber: '091',
      cardName: 'sylveon',
      setCode: 'swsh7',
      variants: { isAltArt: true, rarityHint: 'V' },
      minConfidence: 0.7,
    },
  },
  {
    title: 'PSA 10 Charizard VMAX Rainbow Rare 074/073 Champions Path',
    category: 'psa-slab',
    expected: {
      grading: { company: 'PSA', grade: 10, isSlab: true, gradeTier: 'PSA_10' },
      cardNumber: '074',
      cardName: 'charizard',
      setCode: 'swsh35',
      variants: { isRainbow: true, rarityHint: 'VMAX' },
      minConfidence: 0.7,
    },
  },
  {
    title: 'PSA 10 GEM MINT Mew 8/102 Base Set 1st Edition Shadowless',
    category: 'psa-slab',
    expected: {
      grading: { company: 'PSA', grade: 10, isSlab: true, gradeTier: 'PSA_10' },
      cardNumber: '8',
      cardName: 'mew',
      setCode: 'base1',
      variants: { isFirstEdition: true, isShadowless: true },
      minConfidence: 0.7,
    },
  },
  {
    title: 'PSA 9 Lugia Neo Genesis 9/111 Holo Rare 1st Edition',
    category: 'psa-slab',
    expected: {
      grading: { company: 'PSA', grade: 9, isSlab: true, gradeTier: 'PSA_9' },
      cardNumber: '9',
      cardName: 'lugia',
      setCode: 'neo1',
      variants: { isHolo: true, isFirstEdition: true },
      minConfidence: 0.7,
    },
  },
  {
    title: 'PSA 10 Rayquaza V Alt Art 194/203 Evolving Skies',
    category: 'psa-slab',
    expected: {
      grading: { company: 'PSA', grade: 10, isSlab: true, gradeTier: 'PSA_10' },
      cardNumber: '194',
      cardName: 'rayquaza',
      setCode: 'swsh7',
      variants: { isAltArt: true, rarityHint: 'V' },
      minConfidence: 0.7,
    },
  },
  {
    title: 'PSA 8.5 NM-MT+ Charizard 4/102 Base Set 1999',
    category: 'psa-slab',
    expected: {
      grading: { company: 'PSA', grade: 8.5, isSlab: true, gradeTier: 'PSA_8' },
      cardNumber: '4',
      cardName: 'charizard',
      setCode: 'base1',
      minConfidence: 0.7,
    },
  },
  {
    title: 'PSA 6 Charizard 4/102 Base Set Holo 1999',
    category: 'psa-slab',
    expected: {
      grading: { company: 'PSA', grade: 6, isSlab: true, gradeTier: 'PSA_LOWER' },
      cardNumber: '4',
      cardName: 'charizard',
      minConfidence: 0.7,
    },
  },
  {
    title: 'PSA 10 Pikachu Vmax 044/185 Vivid Voltage',
    category: 'psa-slab',
    expected: {
      grading: { company: 'PSA', grade: 10, isSlab: true, gradeTier: 'PSA_10' },
      cardNumber: '044',
      cardName: 'pikachu',
      setCode: 'swsh4',
      variants: { rarityHint: 'VMAX' },
      minConfidence: 0.7,
    },
  },
  {
    title: 'PSA 10 GEM MINT Giratina V Alt Art 186/196 Lost Origin',
    category: 'psa-slab',
    expected: {
      grading: { company: 'PSA', grade: 10, isSlab: true, gradeTier: 'PSA_10' },
      cardNumber: '186',
      cardName: 'giratina',
      setCode: 'swsh11',
      variants: { isAltArt: true, rarityHint: 'V' },
      minConfidence: 0.7,
    },
  },
  {
    title: 'PSA 10 Greninja ex 106/091 Paldean Fates Special Illustration Rare',
    category: 'psa-slab',
    expected: {
      grading: { company: 'PSA', grade: 10, isSlab: true, gradeTier: 'PSA_10' },
      cardNumber: '106',
      cardName: 'greninja',
      setCode: 'sv4pt5',
      variants: { isAltArt: true, rarityHint: 'ex' },
      minConfidence: 0.7,
    },
  },
  {
    title: 'PSA 9 Charizard Reverse Holo 11/108 Evolutions',
    category: 'psa-slab',
    expected: {
      grading: { company: 'PSA', grade: 9, isSlab: true, gradeTier: 'PSA_9' },
      cardNumber: '11',
      cardName: 'charizard',
      setCode: 'xy12',
      variants: { isReverseHolo: true },
      minConfidence: 0.7,
    },
  },
  {
    title: 'PSA 10 Iono SIR 254/091 Paldean Fates',
    category: 'psa-slab',
    expected: {
      grading: { company: 'PSA', grade: 10, isSlab: true, gradeTier: 'PSA_10' },
      cardNumber: '254',
      cardName: 'iono',
      setCode: 'sv4pt5',
      variants: { isAltArt: true },
      minConfidence: 0.7,
    },
  },

  // ============================================================
  // BGS-graded slabs (10 entries)
  // ============================================================
  {
    title: 'BGS 9.5 GEM MINT Charizard 4/102 Base Set 1999 Holo Rare',
    category: 'bgs-slab',
    expected: {
      grading: { company: 'BGS', grade: 9.5, isSlab: true, gradeTier: 'BGS_9_5' },
      cardNumber: '4',
      cardName: 'charizard',
      setCode: 'base1',
      minConfidence: 0.7,
    },
  },
  {
    title: 'BGS 10 Black Label Pikachu 58/102 Base Set Holo',
    category: 'bgs-slab',
    expected: {
      grading: { company: 'BGS', grade: 10, isSlab: true, gradeTier: 'BGS_10_BLACK' },
      cardNumber: '58',
      cardName: 'pikachu',
      minConfidence: 0.7,
    },
  },
  {
    title: 'BGS 10 Pristine Mew 8/102 Base Set 1st Edition Holo',
    category: 'bgs-slab',
    expected: {
      grading: { company: 'BGS', grade: 10, isSlab: true, gradeTier: 'BGS_10' },
      cardNumber: '8',
      cardName: 'mew',
      variants: { isFirstEdition: true, isHolo: true },
      minConfidence: 0.7,
    },
  },
  {
    title: 'BGS 9 Charizard 4/102 Base Set Holo Rare',
    category: 'bgs-slab',
    expected: {
      grading: { company: 'BGS', grade: 9, isSlab: true, gradeTier: 'BGS_9' },
      cardNumber: '4',
      cardName: 'charizard',
      minConfidence: 0.7,
    },
  },
  {
    title: 'BGS 9.5 Umbreon VMAX 215/203 Alt Art Evolving Skies',
    category: 'bgs-slab',
    expected: {
      grading: { company: 'BGS', grade: 9.5, isSlab: true, gradeTier: 'BGS_9_5' },
      cardNumber: '215',
      cardName: 'umbreon',
      setCode: 'swsh7',
      variants: { isAltArt: true, rarityHint: 'VMAX' },
      minConfidence: 0.7,
    },
  },
  {
    title: 'BGS 8.5 Pikachu Illustrator 4/102 Holo Rare',
    category: 'bgs-slab',
    expected: {
      grading: { company: 'BGS', grade: 8.5, isSlab: true, gradeTier: 'BGS_LOWER' },
      cardNumber: '4',
      cardName: 'pikachu',
      minConfidence: 0.6,
    },
  },
  {
    title: 'BGS 10 Black Label Lugia Neo Genesis 9/111 Holo Rare',
    category: 'bgs-slab',
    expected: {
      grading: { company: 'BGS', grade: 10, isSlab: true, gradeTier: 'BGS_10_BLACK' },
      cardNumber: '9',
      cardName: 'lugia',
      setCode: 'neo1',
      variants: { isHolo: true },
      minConfidence: 0.7,
    },
  },
  {
    title: 'BGS 9.5 Mewtwo 10/102 Base Set Holo 1st Edition',
    category: 'bgs-slab',
    expected: {
      grading: { company: 'BGS', grade: 9.5, isSlab: true, gradeTier: 'BGS_9_5' },
      cardNumber: '10',
      cardName: 'mewtwo',
      setCode: 'base1',
      variants: { isFirstEdition: true, isHolo: true },
      minConfidence: 0.7,
    },
  },
  {
    title: 'BGS 9 Rayquaza V Alt Art 194/203 Evolving Skies',
    category: 'bgs-slab',
    expected: {
      grading: { company: 'BGS', grade: 9, isSlab: true, gradeTier: 'BGS_9' },
      cardNumber: '194',
      cardName: 'rayquaza',
      setCode: 'swsh7',
      variants: { isAltArt: true, rarityHint: 'V' },
      minConfidence: 0.7,
    },
  },
  {
    title: 'BGS 10 Pristine Charizard 4/102 Shadowless Holo',
    category: 'bgs-slab',
    expected: {
      grading: { company: 'BGS', grade: 10, isSlab: true, gradeTier: 'BGS_10' },
      cardNumber: '4',
      cardName: 'charizard',
      variants: { isShadowless: true, isHolo: true },
      minConfidence: 0.7,
    },
  },

  // ============================================================
  // CGC-graded slabs (8 entries)
  // ============================================================
  {
    title: 'CGC 10 Pristine Charizard 4/102 Base Set Holo',
    category: 'cgc-slab',
    expected: {
      grading: { company: 'CGC', grade: 10, isSlab: true, gradeTier: 'CGC_10_PRISTINE' },
      cardNumber: '4',
      cardName: 'charizard',
      setCode: 'base1',
      minConfidence: 0.7,
    },
  },
  {
    title: 'CGC 10 Pikachu 58/102 Base Set Holo Shadowless',
    category: 'cgc-slab',
    expected: {
      grading: { company: 'CGC', grade: 10, isSlab: true, gradeTier: 'CGC_10' },
      cardNumber: '58',
      cardName: 'pikachu',
      setCode: 'base1',
      variants: { isShadowless: true },
      minConfidence: 0.7,
    },
  },
  {
    title: 'CGC 9.5 Charizard VMAX Rainbow 074/073 Champions Path',
    category: 'cgc-slab',
    expected: {
      grading: { company: 'CGC', grade: 9.5, isSlab: true, gradeTier: 'CGC_9_5' },
      cardNumber: '074',
      cardName: 'charizard',
      setCode: 'swsh35',
      variants: { isRainbow: true, rarityHint: 'VMAX' },
      minConfidence: 0.7,
    },
  },
  {
    title: 'CGC 9 Mewtwo 10/102 Base Set Holo Rare',
    category: 'cgc-slab',
    expected: {
      grading: { company: 'CGC', grade: 9, isSlab: true, gradeTier: 'CGC_9' },
      cardNumber: '10',
      cardName: 'mewtwo',
      minConfidence: 0.7,
    },
  },
  {
    title: 'CGC 8.5 Charizard 4/102 Base Set 1999 Holo',
    category: 'cgc-slab',
    expected: {
      grading: { company: 'CGC', grade: 8.5, isSlab: true, gradeTier: 'CGC_LOWER' },
      cardNumber: '4',
      cardName: 'charizard',
      minConfidence: 0.6,
    },
  },
  {
    title: 'CGC 10 Pristine Umbreon VMAX 215/203 Alt Art Evolving Skies',
    category: 'cgc-slab',
    expected: {
      grading: { company: 'CGC', grade: 10, isSlab: true, gradeTier: 'CGC_10_PRISTINE' },
      cardNumber: '215',
      cardName: 'umbreon',
      setCode: 'swsh7',
      variants: { isAltArt: true, rarityHint: 'VMAX' },
      minConfidence: 0.7,
    },
  },
  {
    title: 'CGC Pristine 10 Sylveon V Alt Art 091/069 Evolving Skies',
    category: 'cgc-slab',
    expected: {
      grading: { company: 'CGC', grade: 10, isSlab: true, gradeTier: 'CGC_10_PRISTINE' },
      cardNumber: '091',
      cardName: 'sylveon',
      variants: { isAltArt: true, rarityHint: 'V' },
      minConfidence: 0.7,
    },
  },
  {
    title: 'CGC 10 Pikachu Vmax 044/185 Vivid Voltage',
    category: 'cgc-slab',
    expected: {
      grading: { company: 'CGC', grade: 10, isSlab: true, gradeTier: 'CGC_10' },
      cardNumber: '044',
      cardName: 'pikachu',
      setCode: 'swsh4',
      variants: { rarityHint: 'VMAX' },
      minConfidence: 0.7,
    },
  },

  // ============================================================
  // SGC / AGS / ACE → OTHER_GRADED (4 entries)
  // ============================================================
  {
    title: 'SGC 10 PRISTINE Charizard 4/102 Base Set Holo',
    category: 'other-slab',
    expected: {
      grading: { company: 'SGC', grade: 10, isSlab: true, gradeTier: 'OTHER_GRADED' },
      cardNumber: '4',
      cardName: 'charizard',
      minConfidence: 0.7,
    },
  },
  {
    title: 'SGC 9 Pikachu 58/102 Base Set Shadowless',
    category: 'other-slab',
    expected: {
      grading: { company: 'SGC', grade: 9, isSlab: true, gradeTier: 'OTHER_GRADED' },
      cardNumber: '58',
      cardName: 'pikachu',
      minConfidence: 0.6,
    },
  },
  {
    title: 'AGS 10 Charizard 4/102 Base Set Holo',
    category: 'other-slab',
    expected: {
      grading: { company: 'OTHER', grade: 10, isSlab: true, gradeTier: 'OTHER_GRADED' },
      cardNumber: '4',
      cardName: 'charizard',
      minConfidence: 0.7,
    },
  },
  {
    title: 'ACE 10 Mewtwo 10/102 Base Set Holo',
    category: 'other-slab',
    expected: {
      grading: { company: 'OTHER', grade: 10, isSlab: true, gradeTier: 'OTHER_GRADED' },
      cardNumber: '10',
      cardName: 'mewtwo',
      minConfidence: 0.7,
    },
  },

  // ============================================================
  // Raw NM single cards (12 entries)
  // ============================================================
  {
    title: 'Charizard 4/102 Base Set Holo Rare NM',
    category: 'raw-nm',
    expected: {
      grading: { isSlab: false },
      condition: 'NEAR_MINT',
      cardNumber: '4',
      cardName: 'charizard',
      setCode: 'base1',
      variants: { isHolo: true },
      isLot: false,
      minConfidence: 0.6,
    },
  },
  {
    title: 'Pikachu 58/102 Base Set Near Mint',
    category: 'raw-nm',
    expected: {
      grading: { isSlab: false },
      condition: 'NEAR_MINT',
      cardNumber: '58',
      cardName: 'pikachu',
      setCode: 'base1',
      minConfidence: 0.6,
    },
  },
  {
    title: 'Sylveon V Alt Art 091/069 Evolving Skies NM',
    category: 'raw-nm',
    expected: {
      grading: { isSlab: false },
      condition: 'NEAR_MINT',
      cardNumber: '091',
      cardName: 'sylveon',
      setCode: 'swsh7',
      variants: { isAltArt: true, rarityHint: 'V' },
      minConfidence: 0.6,
    },
  },
  {
    title: 'Charizard VMAX 020/189 Darkness Ablaze NM Holo',
    category: 'raw-nm',
    expected: {
      grading: { isSlab: false },
      condition: 'NEAR_MINT',
      cardNumber: '020',
      cardName: 'charizard',
      setCode: 'swsh3',
      variants: { isHolo: true, rarityHint: 'VMAX' },
      minConfidence: 0.6,
    },
  },
  {
    title: 'Mewtwo 10/102 Base Set Holo NM-MT',
    category: 'raw-nm',
    expected: {
      grading: { isSlab: false },
      condition: 'NEAR_MINT',
      cardNumber: '10',
      cardName: 'mewtwo',
      setCode: 'base1',
      minConfidence: 0.6,
    },
  },
  {
    title: 'Umbreon VMAX 215/203 Alt Art Evolving Skies Near-Mint',
    category: 'raw-nm',
    expected: {
      grading: { isSlab: false },
      condition: 'NEAR_MINT',
      cardNumber: '215',
      cardName: 'umbreon',
      setCode: 'swsh7',
      variants: { isAltArt: true, rarityHint: 'VMAX' },
      minConfidence: 0.6,
    },
  },
  {
    title: 'Lugia Neo Genesis 9/111 Holo Rare 1st Edition NM',
    category: 'raw-nm',
    expected: {
      grading: { isSlab: false },
      condition: 'NEAR_MINT',
      cardNumber: '9',
      cardName: 'lugia',
      setCode: 'neo1',
      variants: { isFirstEdition: true, isHolo: true },
      minConfidence: 0.6,
    },
  },
  {
    title: 'Greninja ex 106/091 Paldean Fates SIR NM',
    category: 'raw-nm',
    expected: {
      grading: { isSlab: false },
      condition: 'NEAR_MINT',
      cardNumber: '106',
      cardName: 'greninja',
      setCode: 'sv4pt5',
      variants: { isAltArt: true, rarityHint: 'ex' },
      minConfidence: 0.6,
    },
  },
  {
    title: 'Iono SIR 254/091 Paldean Fates NM',
    category: 'raw-nm',
    expected: {
      grading: { isSlab: false },
      condition: 'NEAR_MINT',
      cardNumber: '254',
      cardName: 'iono',
      setCode: 'sv4pt5',
      variants: { isAltArt: true },
      minConfidence: 0.6,
    },
  },
  {
    title: 'Charizard Reverse Holo 11/108 Evolutions NM',
    category: 'raw-nm',
    expected: {
      grading: { isSlab: false },
      condition: 'NEAR_MINT',
      cardNumber: '11',
      cardName: 'charizard',
      setCode: 'xy12',
      variants: { isReverseHolo: true },
      minConfidence: 0.6,
    },
  },
  {
    title: 'Pikachu VMAX 044/185 Vivid Voltage Mint',
    category: 'raw-nm',
    expected: {
      grading: { isSlab: false },
      condition: 'MINT',
      cardNumber: '044',
      cardName: 'pikachu',
      setCode: 'swsh4',
      variants: { rarityHint: 'VMAX' },
      minConfidence: 0.6,
    },
  },
  {
    title: 'Giratina V Alt Art 186/196 Lost Origin Mint Condition',
    category: 'raw-nm',
    expected: {
      grading: { isSlab: false },
      condition: 'MINT',
      cardNumber: '186',
      cardName: 'giratina',
      setCode: 'swsh11',
      variants: { isAltArt: true, rarityHint: 'V' },
      minConfidence: 0.6,
    },
  },

  // ============================================================
  // Raw played (LP / MP / HP / DMG) (8 entries)
  // ============================================================
  {
    title: 'Charizard 4/102 Base Set Holo LP Lightly Played',
    category: 'raw-played',
    expected: {
      grading: { isSlab: false },
      condition: 'LIGHTLY_PLAYED',
      cardNumber: '4',
      cardName: 'charizard',
      minConfidence: 0.5,
    },
  },
  {
    title: 'Pikachu 58/102 Base Set MP Moderately Played',
    category: 'raw-played',
    expected: {
      grading: { isSlab: false },
      condition: 'MODERATELY_PLAYED',
      cardNumber: '58',
      cardName: 'pikachu',
      minConfidence: 0.5,
    },
  },
  {
    title: 'Mewtwo 10/102 Base Set Heavily Played',
    category: 'raw-played',
    expected: {
      grading: { isSlab: false },
      condition: 'HEAVILY_PLAYED',
      cardNumber: '10',
      cardName: 'mewtwo',
      minConfidence: 0.5,
    },
  },
  {
    title: 'Charizard 4/102 Base Set Damaged DMG Holo',
    category: 'raw-played',
    expected: {
      grading: { isSlab: false },
      condition: 'DAMAGED',
      cardNumber: '4',
      cardName: 'charizard',
      minConfidence: 0.5,
    },
  },
  {
    title: 'Charizard Base Set Holo Played',
    category: 'raw-played',
    expected: {
      grading: { isSlab: false },
      condition: 'MODERATELY_PLAYED',
      cardName: 'charizard',
      minConfidence: 0.4,
    },
  },
  {
    title: 'Lugia Neo Genesis 9/111 LP Holo',
    category: 'raw-played',
    expected: {
      grading: { isSlab: false },
      condition: 'LIGHTLY_PLAYED',
      cardNumber: '9',
      cardName: 'lugia',
      setCode: 'neo1',
      minConfidence: 0.5,
    },
  },
  {
    title: 'Blastoise 2/102 Base Set Holo HP Heavily Played',
    category: 'raw-played',
    expected: {
      grading: { isSlab: false },
      condition: 'HEAVILY_PLAYED',
      cardNumber: '2',
      cardName: 'blastoise',
      minConfidence: 0.5,
    },
  },
  {
    title: 'Venusaur 15/102 Base Set Poor Damaged Holo',
    category: 'raw-played',
    expected: {
      grading: { isSlab: false },
      condition: 'DAMAGED',
      cardNumber: '15',
      cardName: 'venusaur',
      minConfidence: 0.5,
    },
  },

  // ============================================================
  // Lots (10 entries)
  // ============================================================
  {
    title: 'Pokemon Lot of 50 Cards Bulk!',
    category: 'lot',
    expected: { isLot: true, lotSize: 50 },
  },
  {
    title: '100x Pokemon Cards Bulk Lot',
    category: 'lot',
    expected: { isLot: true, lotSize: 100 },
  },
  {
    title: 'Pokemon Card Lot 200 Cards Holo Rare Bulk',
    category: 'lot',
    expected: { isLot: true, lotSize: 200 },
  },
  {
    title: 'Pokemon Brilliant Stars Booster Box Sealed',
    category: 'lot',
    expected: { isLot: true, setCode: 'swsh9' },
  },
  {
    title: 'Pokemon Crown Zenith Elite Trainer Box Sealed',
    category: 'lot',
    expected: { isLot: true, setCode: 'swsh125' },
  },
  {
    title: 'Pokemon Base Set Complete Master Set Charizard 4/102 Holo Rare',
    category: 'lot',
    expected: { isLot: true, setCode: 'base1' },
  },
  {
    title: 'Pokemon Binder Lot Full Vintage Holos 1999',
    category: 'lot',
    expected: { isLot: true },
  },
  {
    title: 'Pokemon TCG Lot of 1000 Cards Bulk Wholesale',
    category: 'lot',
    expected: { isLot: true, lotSize: 1000 },
  },
  {
    title: 'Pokemon 50 cards Lot Holo Rare',
    category: 'lot',
    expected: { isLot: true, lotSize: 50 },
  },
  {
    title: 'Pokemon Booster Pack Sealed Vintage 1999',
    category: 'lot',
    expected: { isLot: true },
  },

  // ============================================================
  // Japanese listings (10 entries)
  // ============================================================
  {
    title: 'Japanese Charizard 1st Edition Base Set Holo Rare',
    category: 'jp',
    expected: {
      language: 'jp',
      cardName: 'charizard',
      variants: { isFirstEdition: true, isHolo: true },
      minConfidence: 0.4,
    },
  },
  {
    title: 'Pokemon Japanese Pikachu V Alt Art 270/172 Sword Shield Promo',
    category: 'jp',
    expected: {
      language: 'jp',
      cardNumber: '270',
      cardName: 'pikachu',
      variants: { isAltArt: true, rarityHint: 'V', isPromo: true },
      minConfidence: 0.5,
    },
  },
  {
    title: '1st Edition Japanese Mewtwo Base Set Holo Rare',
    category: 'jp',
    expected: {
      language: 'jp',
      cardName: 'mewtwo',
      variants: { isFirstEdition: true, isHolo: true },
      minConfidence: 0.4,
    },
  },
  {
    title: 'Japanese Eevee Heroes Sylveon V Alt Art 091/069 NM',
    category: 'jp',
    expected: {
      language: 'jp',
      cardNumber: '091',
      cardName: 'sylveon',
      condition: 'NEAR_MINT',
      variants: { isAltArt: true, rarityHint: 'V' },
      minConfidence: 0.5,
    },
  },
  {
    title: 'PSA 10 Japanese Charizard VMAX 308/SM-P Promo',
    category: 'jp',
    expected: {
      language: 'jp',
      grading: { company: 'PSA', grade: 10, isSlab: true },
      cardName: 'charizard',
      variants: { isPromo: true, rarityHint: 'VMAX' },
      minConfidence: 0.6,
    },
  },
  {
    title: 'Japanese Lugia Neo Genesis Holo 1st Edition',
    category: 'jp',
    expected: {
      language: 'jp',
      cardName: 'lugia',
      setCode: 'neo1',
      variants: { isFirstEdition: true, isHolo: true },
      minConfidence: 0.4,
    },
  },
  {
    title: 'Japanese Pokemon Center Mew Pikachu Promo',
    category: 'jp',
    expected: {
      language: 'jp',
      variants: { isPromo: true },
      minConfidence: 0.3,
    },
  },
  {
    title: 'BGS 9.5 Japanese Charizard 4/102 1st Edition Base Set Holo',
    category: 'jp',
    expected: {
      language: 'jp',
      grading: { company: 'BGS', grade: 9.5, isSlab: true },
      cardNumber: '4',
      cardName: 'charizard',
      variants: { isFirstEdition: true, isHolo: true },
      minConfidence: 0.7,
    },
  },
  {
    title: 'Japanese Charizard Holo 002/165 151 Pokemon NM',
    category: 'jp',
    expected: {
      language: 'jp',
      cardNumber: '002',
      cardName: 'charizard',
      condition: 'NEAR_MINT',
      variants: { isHolo: true },
      minConfidence: 0.5,
    },
  },
  {
    title: 'Japanese Eevee Heroes Master Ball Pattern Sylveon V',
    category: 'jp',
    expected: {
      language: 'jp',
      cardName: 'sylveon',
      variants: { isMasterBallPattern: true, rarityHint: 'V' },
      minConfidence: 0.3,
    },
  },

  // ============================================================
  // Variant-bearing listings (12 entries)
  // ============================================================
  {
    title: 'Charizard 4/102 Base Set 1st Edition Shadowless Holo Rare NM',
    category: 'variant',
    expected: {
      grading: { isSlab: false },
      cardNumber: '4',
      cardName: 'charizard',
      setCode: 'base1',
      variants: { isFirstEdition: true, isShadowless: true, isHolo: true },
      condition: 'NEAR_MINT',
      minConfidence: 0.6,
    },
  },
  {
    title: 'Charizard VMAX Rainbow Rare Secret 074/073 Champions Path Mint',
    category: 'variant',
    expected: {
      cardNumber: '074',
      cardName: 'charizard',
      setCode: 'swsh35',
      variants: { isRainbow: true, isSecretRare: true, rarityHint: 'VMAX' },
      condition: 'MINT',
      minConfidence: 0.5,
    },
  },
  {
    title: 'Charizard Gold Rare 070/070 Vivid Voltage Hyper Secret',
    category: 'variant',
    expected: {
      cardNumber: '070',
      cardName: 'charizard',
      setCode: 'swsh4',
      variants: { isGold: true, isSecretRare: true },
      minConfidence: 0.5,
    },
  },
  {
    title: 'Charizard V Full Art Promo SWSH050 Black Star Promo',
    category: 'variant',
    expected: {
      cardNumber: 'SWSH050',
      cardName: 'charizard',
      variants: { isFullArt: true, isPromo: true, rarityHint: 'V' },
      minConfidence: 0.5,
    },
  },
  {
    title: 'Pikachu Reverse Holo 58/102 Base Set NM',
    category: 'variant',
    expected: {
      condition: 'NEAR_MINT',
      cardNumber: '58',
      cardName: 'pikachu',
      setCode: 'base1',
      variants: { isReverseHolo: true },
      minConfidence: 0.6,
    },
  },
  {
    title: 'Pikachu Master Ball Pattern Reverse Holo 025/165 Pokemon 151',
    category: 'variant',
    expected: {
      cardNumber: '025',
      cardName: 'pikachu',
      setCode: 'sv35',
      variants: { isMasterBallPattern: true, isReverseHolo: true },
      minConfidence: 0.5,
    },
  },
  {
    title: 'Pikachu Poke Ball Pattern Reverse Holo 025/165 Pokemon 151',
    category: 'variant',
    expected: {
      cardNumber: '025',
      cardName: 'pikachu',
      variants: { isPokeBallPattern: true, isReverseHolo: true },
      minConfidence: 0.5,
    },
  },
  {
    title: 'Charizard 4/102 Shadowless Holo Rare 1999 Base Set NM',
    category: 'variant',
    expected: {
      cardNumber: '4',
      cardName: 'charizard',
      condition: 'NEAR_MINT',
      variants: { isShadowless: true, isHolo: true },
      minConfidence: 0.6,
    },
  },
  {
    title: 'Iono Special Illustration Rare 254/091 Paldean Fates Mint',
    category: 'variant',
    expected: {
      cardNumber: '254',
      cardName: 'iono',
      condition: 'MINT',
      variants: { isAltArt: true },
      minConfidence: 0.6,
    },
  },
  {
    title: 'Charizard ex 199/197 Obsidian Flames SIR Mint',
    category: 'variant',
    expected: {
      cardNumber: '199',
      cardName: 'charizard',
      setCode: 'sv3',
      variants: { isAltArt: true, rarityHint: 'ex' },
      minConfidence: 0.6,
    },
  },
  {
    title: 'Mewtwo BREAK 64/162 BREAKthrough Holo Rare NM',
    category: 'variant',
    expected: {
      cardNumber: '64',
      cardName: 'mewtwo',
      variants: { isHolo: true, rarityHint: 'BREAK' },
      minConfidence: 0.5,
    },
  },
  {
    title: 'Charizard GX 9/68 Hidden Fates Full Art NM',
    category: 'variant',
    expected: {
      cardNumber: '9',
      cardName: 'charizard',
      setCode: 'sm115',
      variants: { isFullArt: true, rarityHint: 'GX' },
      condition: 'NEAR_MINT',
      minConfidence: 0.6,
    },
  },

  // ============================================================
  // Sub-set / promo numbering (4 entries)
  // ============================================================
  {
    title: 'PSA 10 Charizard V TG10/TG30 Astral Radiance Trainer Gallery',
    category: 'subset-numbered',
    expected: {
      grading: { company: 'PSA', grade: 10, isSlab: true, gradeTier: 'PSA_10' },
      cardNumber: 'TG10',
      cardName: 'charizard',
      setCode: 'swsh10',
      variants: { rarityHint: 'V' },
      minConfidence: 0.7,
    },
  },
  {
    title: 'Giratina VSTAR GG70/GG70 Crown Zenith Galarian Gallery NM',
    category: 'subset-numbered',
    expected: {
      grading: { isSlab: false },
      cardNumber: 'GG70',
      cardName: 'giratina',
      setCode: 'swsh125',
      variants: { rarityHint: 'VSTAR' },
      condition: 'NEAR_MINT',
      minConfidence: 0.6,
    },
  },
  {
    title: 'Pikachu V Black Star Promo SWSH061 Mint',
    category: 'subset-numbered',
    expected: {
      cardNumber: 'SWSH061',
      cardName: 'pikachu',
      condition: 'MINT',
      variants: { isPromo: true, rarityHint: 'V' },
      minConfidence: 0.6,
    },
  },
  {
    title: 'Charizard Pokemon Center XY174 Black Star Promo Holo',
    category: 'subset-numbered',
    expected: {
      cardNumber: 'XY174',
      cardName: 'charizard',
      variants: { isPromo: true, isHolo: true },
      minConfidence: 0.5,
    },
  },

  // ============================================================
  // Pokemon Center / promo / staff (4 entries)
  // ============================================================
  {
    title: 'Pokemon Center Stamped Charizard 4/102 Base Set Holo',
    category: 'pokemon-center',
    expected: {
      cardNumber: '4',
      cardName: 'charizard',
      setCode: 'base1',
      variants: { isHolo: true },
      minConfidence: 0.4,
    },
  },
  {
    title: 'Pikachu Staff Stamped Promo SWSH061',
    category: 'pokemon-center',
    expected: {
      cardNumber: 'SWSH061',
      cardName: 'pikachu',
      variants: { isStaff: true, isPromo: true },
      minConfidence: 0.5,
    },
  },
  {
    title: 'Charizard Pre-release Stamped 4/102 Base Set Holo NM',
    category: 'pokemon-center',
    expected: {
      cardNumber: '4',
      cardName: 'charizard',
      condition: 'NEAR_MINT',
      variants: { isPrerelease: true, isHolo: true },
      minConfidence: 0.5,
    },
  },
  {
    title: 'PSA 10 Pikachu Pokemon Center 25th Anniversary Promo',
    category: 'pokemon-center',
    expected: {
      grading: { company: 'PSA', grade: 10, isSlab: true },
      cardName: 'pikachu',
      variants: { isPromo: true },
      minConfidence: 0.5,
    },
  },

  // ============================================================
  // Pathological / typo-laden / mislabeled (8 entries)
  // ============================================================
  {
    title: 'pokemon!!!!! charizard FIRE TYPE!!! 1999 SUPER RARE!!!',
    category: 'pathological',
    expected: {
      grading: { isSlab: false },
      cardName: 'charizard',
    },
  },
  {
    title: '????',
    category: 'pathological',
    expected: { grading: { isSlab: false }, isLot: false },
  },
  {
    title: 'Pokemon ⭐✨🔥 Charizard 1999 ⭐⭐⭐ Holo!!!',
    category: 'pathological',
    expected: {
      cardName: 'charizard',
      variants: { isHolo: true },
    },
  },
  {
    title: 'Charizard',
    category: 'pathological',
    expected: { cardName: 'charizard' },
  },
  {
    title: 'PSA Authentic Charizard 4/102 Base Set Holo No Grade',
    category: 'pathological',
    expected: {
      grading: { isSlab: false },
      cardNumber: '4',
      cardName: 'charizard',
    },
  },
  {
    title: 'Graded Pokemon Card Charizard',
    category: 'pathological',
    expected: {
      grading: { isSlab: true, grade: null, gradeTier: null },
      cardName: 'charizard',
    },
  },
  {
    title: '   ',
    category: 'pathological',
    expected: { grading: { isSlab: false } },
  },
  {
    title: 'pokémon — japonais — dracaufeu',
    category: 'pathological',
    expected: { grading: { isSlab: false } },
  },
];
