// Test fixtures for resource tests. Pre-built DTO objects that
// match the api-contracts schemas; each test that wants to mock a
// fetch response imports a fixture and wraps it in the result
// envelope via `okEnvelope`.
//
// Test-only; excluded from the build via tsconfig.

const SET_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const CARD_ID = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const PRINTING_ID = 'cccccccc-3333-4333-8333-cccccccccccc';
const COLLECTION_ITEM_ID = 'dddddddd-4444-4444-8444-dddddddddddd';
const CUSTOM_COLLECTION_ID = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee';
const USER_ID = 'ffffffff-6666-4666-8666-ffffffffffff';
const SHAREABLE_ID = '11111111-7777-4777-8777-111111111111';
const GRADING_ID = '22222222-8888-4888-8888-222222222222';

const NOW = '2026-05-05T12:00:00Z';
const TODAY = '2026-05-05';

export const FIXTURE_IDS = {
  setId: SET_ID,
  cardId: CARD_ID,
  printingId: PRINTING_ID,
  collectionItemId: COLLECTION_ITEM_ID,
  customCollectionId: CUSTOM_COLLECTION_ID,
  userId: USER_ID,
  shareableId: SHAREABLE_ID,
  gradingId: GRADING_ID,
} as const;

export const VALID_SET = {
  id: SET_ID,
  canonicalKey: 'en-swsh9',
  code: 'swsh9',
  language: 'en' as const,
  name: 'Brilliant Stars',
  series: 'Sword & Shield',
  releaseDate: '2022-02-25',
  printedTotal: 172,
  total: 186,
  logoUrl: 'https://images.binderly.app/sets/swsh9/logo.webp',
  symbolUrl: 'https://images.binderly.app/sets/swsh9/symbol.webp',
  masterSetRules: {},
  createdAt: NOW,
  updatedAt: NOW,
};

export const VALID_CARD = {
  id: CARD_ID,
  canonicalKey: 'en-swsh9-018',
  setId: SET_ID,
  language: 'en' as const,
  number: '018',
  name: 'Charizard VSTAR',
  nameLocalized: { en: 'Charizard VSTAR' },
  type: 'FIRE' as const,
  subtype: 'POKEMON' as const,
  hp: 280,
  illustrator: '5ban Graphics',
  flavorText: null,
  attacks: [],
  weakness: null,
  resistance: null,
  retreatCost: 2,
  rarity: 'ULTRA_RARE' as const,
  createdAt: NOW,
  updatedAt: NOW,
};

export const VALID_PRINTING = {
  id: PRINTING_ID,
  variantKey: 'en-swsh9-018-holo',
  cardId: CARD_ID,
  variantClass: 'HOLO' as const,
  variantFlags: [],
  variantCode: 'holo',
  includeInMasterSet: true,
  imageSmallUrl: 'https://images.binderly.app/printings/en-swsh9-018-holo/small.webp',
  imageLargeUrl: 'https://images.binderly.app/printings/en-swsh9-018-holo/large.webp',
  createdAt: NOW,
  updatedAt: NOW,
};

export const VALID_CARD_WITH_PRINTINGS = {
  ...VALID_CARD,
  printings: [VALID_PRINTING],
};

export const VALID_PRINTING_WITH_CONTEXT = {
  ...VALID_PRINTING,
  card: VALID_CARD,
  set: VALID_SET,
};

export const VALID_COLLECTION_ITEM = {
  id: COLLECTION_ITEM_ID,
  userId: USER_ID,
  printingId: PRINTING_ID,
  quantity: 1,
  condition: 'NEAR_MINT' as const,
  gradeCompany: null,
  grade: null,
  acquiredAt: null,
  acquiredPrice: null,
  acquiredCurrency: null,
  notes: null,
  photoUrls: [],
  source: 'manual' as const,
  createdAt: NOW,
  updatedAt: NOW,
};

export const VALID_CUSTOM_COLLECTION = {
  id: CUSTOM_COLLECTION_ID,
  userId: USER_ID,
  name: 'Charizard Hunters',
  slug: 'charizard-hunters',
  kind: 'manual' as const,
  description: null,
  coverUrl: null,
  createdAt: NOW,
  updatedAt: NOW,
};

export const VALID_CUSTOM_COLLECTION_ITEM = {
  customCollectionId: CUSTOM_COLLECTION_ID,
  printingId: PRINTING_ID,
  addedAt: NOW,
};

export const VALID_SMART_RULE = {
  customCollectionId: CUSTOM_COLLECTION_ID,
  expression: { op: 'has_type', value: 'FIRE' },
  lastEvaluatedAt: NOW,
};

export const VALID_MARKET = {
  code: 'EBAY_US' as const,
  displayName: 'eBay US',
  tier: 'primary' as const,
  defaultCurrency: 'USD',
  region: 'US',
  notes: null,
};

export const VALID_CURRENT_PRICE = {
  printingId: PRINTING_ID,
  gradeTier: 'RAW_NM' as const,
  market: 'EBAY_US' as const,
  currency: 'USD',
  periodStart: TODAY,
  medianPrice: '120.00',
  meanPrice: '125.00',
  lowPrice: '90.00',
  highPrice: '160.00',
  sampleCount: 25,
  computedAt: NOW,
};

export const VALID_PRICE_AGGREGATE = {
  printingId: PRINTING_ID,
  gradeTier: 'RAW_NM' as const,
  market: 'EBAY_US' as const,
  currency: 'USD',
  periodStart: TODAY,
  periodEnd: TODAY,
  medianPrice: '120.00',
  meanPrice: '125.00',
  lowPrice: '90.00',
  highPrice: '160.00',
  sampleCount: 25,
  sourceBreakdown: { ebay_browse: 25 },
  observationKindBreakdown: { sold: 20, active_listing: 5 },
  computedAt: NOW,
};

export const VALID_FX_RATE = {
  rateDate: TODAY,
  baseCurrency: 'USD',
  quoteCurrency: 'EUR',
  rate: '0.92',
  fetchedAt: NOW,
  source: 'frankfurter',
};

export const VALID_GRADING_SUBMISSION = {
  id: GRADING_ID,
  userId: USER_ID,
  printingId: PRINTING_ID,
  frontUrl: 'https://images.binderly.app/grading/g/front.webp',
  backUrl: 'https://images.binderly.app/grading/g/back.webp',
  cornerUrls: [
    'https://images.binderly.app/grading/g/c1.webp',
    'https://images.binderly.app/grading/g/c2.webp',
    'https://images.binderly.app/grading/g/c3.webp',
    'https://images.binderly.app/grading/g/c4.webp',
  ],
  surfaceUrl: 'https://images.binderly.app/grading/g/surface.webp',
  predicted: {
    centering: 9,
    corners: 9.5,
    edges: 9,
    surface: 9.5,
    aggregate: 9,
    confidence: 0.78,
  },
  actual: null,
  status: 'predicted' as const,
  createdAt: NOW,
  updatedAt: NOW,
};

export const VALID_SHAREABLE = {
  id: SHAREABLE_ID,
  userId: USER_ID,
  slug: 'my-binder',
  target: { kind: 'full' as const },
  theme: 'default' as const,
  showValues: false,
  showMissing: true,
  showPhotos: false,
  createdAt: NOW,
  updatedAt: NOW,
};

export const VALID_PROFILE = {
  userId: USER_ID,
  handle: 'pablo',
  displayName: 'Pablo',
  avatarUrl: null,
  bio: null,
  preferences: {},
  createdAt: NOW,
  updatedAt: NOW,
};

export const VALID_SUBSCRIPTION = {
  userId: USER_ID,
  tier: 'free' as const,
  source: null,
  externalCustomerId: null,
  expiresAt: null,
  lastEventAt: null,
};

export const VALID_ENTITLEMENTS_FREE = {
  tier: 'free' as const,
  activeFeatures: [] as const,
  source: 'revenuecat' as const,
  checkedAt: NOW,
};

export const VALID_ENTITLEMENTS_PRO = {
  tier: 'pro' as const,
  activeFeatures: [
    'stack_scanner',
    'grading_prediction',
    'unlimited_custom_collections',
    'save_smart_collections',
    'unlimited_shareables',
    'shareable_themes',
    'pricing_history',
    'export_data',
    'cloud_ai_scan',
  ] as const,
  source: 'revenuecat' as const,
  checkedAt: NOW,
};

export const VALID_PAGE = <T>(items: T[]): { items: T[]; nextCursor: string | null } => ({
  items,
  nextCursor: null,
});

export const VALID_COMPLETION = {
  global: {
    allPokemonPct: 12.5,
    masterPct: 4.0,
    uniqueCardsOwned: 100,
    uniqueCardsTotal: 800,
    masterOwned: 40,
    masterTotal: 1000,
  },
  perSet: [
    {
      setId: SET_ID,
      setCode: 'swsh9',
      setName: 'Brilliant Stars',
      setPct: 42.5,
      masterPct: 17.0,
      ownedNumbered: 85,
      totalNumbered: 200,
      ownedMaster: 34,
      totalMaster: 200,
    },
  ],
  lastUpdatedAt: NOW,
};

export const VALID_PRINTING_CURRENT_PRICE = {
  printingId: PRINTING_ID,
  gradeTier: 'RAW_NM' as const,
  market: 'EBAY_US' as const,
  currency: 'USD',
  periodStart: TODAY,
  medianPrice: '120.00',
  meanPrice: '125.00',
  lowPrice: '90.00',
  highPrice: '160.00',
  sampleCount: 25,
  computedAt: NOW,
  freshness: 'fresh' as const,
};

export const VALID_PUBLIC_SHAREABLE_PAYLOAD = {
  shareable: {
    id: SHAREABLE_ID,
    userId: USER_ID,
    slug: 'my-binder',
    target: { kind: 'full' as const },
    theme: 'default' as const,
    showValues: false,
    showMissing: true,
    showPhotos: false,
    createdAt: NOW,
    updatedAt: NOW,
  },
  owner: {
    handle: 'pablo',
    displayName: 'Pablo',
    avatarUrl: null,
    bio: null,
  },
  collectionTitle: "Pablo's collection",
  description: null,
  counts: {
    ownedUnique: 1,
    ownedTotalQuantity: 1,
    catalogTotal: 800,
    completionPct: 0.125,
  },
  members: [
    {
      printingId: PRINTING_ID,
      cardId: CARD_ID,
      cardName: 'Charizard VSTAR',
      cardNumber: '018',
      setName: 'Brilliant Stars',
      setCode: 'swsh9',
      variantLabel: 'Holo',
      imageUrl: null,
      quantity: 1,
    },
  ],
  lastUpdatedAt: NOW,
};

export const VALID_SMART_PREVIEW_REQUEST = {
  expression: { type: 'eq' as const, field: 'card.name' as const, value: 'Charizard' },
  limit: 50,
  offset: 0,
};

export const VALID_SMART_PREVIEW_RESPONSE = {
  items: [
    {
      printingId: PRINTING_ID,
      cardId: CARD_ID,
      setId: SET_ID,
      cardName: 'Charizard VSTAR',
      cardNumber: '018',
      setName: 'Brilliant Stars',
      setCode: 'swsh9',
      variantLabel: 'Holo',
      imageSmallUrl: null,
    },
  ],
  totalCount: 1,
  nextOffset: null,
};
