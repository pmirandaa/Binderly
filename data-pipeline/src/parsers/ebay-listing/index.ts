// Public barrel for the eBay listing parser.
//
// Downstream consumers (T-DL-PRICING-EBAY-BROWSE,
// T-DL-PRICING-AGGREGATOR) import only `parseEbayListing` and
// `resolveListingToPrinting` plus the `ParsedListing` type. The pass
// internals are deliberately not re-exported — they're an
// implementation detail.
//
// `ParserCatalogReader` is exported because downstream tasks need
// to implement it against `@binderly/db`.

export { parseEbayListing } from './parse.js';
export { resolveListingToPrinting } from './joiner.js';
export type {
  JoinerResult,
  ParserCatalogCard,
  ParserCatalogPrinting,
  ParserCatalogReader,
} from './joiner.js';
export {
  CONDITIONS,
  GRADE_COMPANIES,
  GRADE_TIERS,
  LISTING_LANGUAGES,
  RARITY_HINTS,
  emptyGradingHints,
  emptyVariantHints,
  parsedListingSchema,
  conditionSchema,
  gradeCompanySchema,
  gradeTierSchema,
  listingLanguageSchema,
  rarityHintSchema,
  variantHintsSchema,
  gradingHintsSchema,
  setHintsSchema,
  cardHintsSchema,
} from './types.js';
export type {
  CardHints,
  Condition,
  GradeCompany,
  GradeTier,
  GradingHints,
  ListingLanguage,
  ParsedListing,
  RarityHint,
  SetHints,
  VariantHints,
} from './types.js';
export { conditionToTier, gradeToTier, validateGrade } from './grade-scales.js';
