// Public barrel for the Bulbapedia adapter.
//
// External consumers import from `@binderly/data-pipeline` (which
// re-exports through `data-pipeline/src/adapters/index.ts`); internal
// modules can pull directly from this file.

export {
  BulbapediaAdapter,
  createBulbapediaAdapter,
  BULBAPEDIA_HOST,
  BULBAPEDIA_DEFAULT_BASE_URL,
  BULBAPEDIA_DEFAULT_BASE_PATH,
  BULBAPEDIA_DEFAULT_RPS,
  BULBAPEDIA_DEFAULT_BURST,
  type BulbapediaAdapterConfig,
} from './adapter.js';
export {
  BULBAPEDIA_EN_SOURCE,
  bulbapediaWikitextToSet,
  bulbapediaWikitextToCard,
  bulbapediaWikitextToPrintings,
  bulbapediaParsedSetToRaw,
  bulbapediaParsedCardToRaw,
  bulbapediaParsedCardToPrintings,
  padCardNumber,
  isBulbapediaPromoSet,
  resolveBulbapediaSetCode,
} from './transform.js';
export {
  BULBAPEDIA_SET_CODE_TABLE,
  tcgdexCodeForBulbapediaSet,
  slugifyBulbapediaSetName,
} from './set-codes.js';
export { parseCardInfobox } from './parsers/card-infobox.js';
export { parseSetInfobox } from './parsers/set-infobox.js';
export {
  parseTemplateBlocks,
  parseInfoboxBlock,
  splitTopLevelByPipe,
  findTopLevelEquals,
  findBalancedTemplateEnd,
  stripWikitextLinks,
  unwrapWikitextItalics,
  normalizeWhitespace,
  stripHtmlComments,
  flattenWikitextValue,
} from './parsers/wikitext-infobox.js';
export { parseCardPageTitle, parseSetPageTitle } from './parsers/page-title.js';
export type {
  MediaWikiCategoryMember,
  MediaWikiCategoryMembersResponse,
  MediaWikiPage,
  MediaWikiQueryRevisionsResponse,
  MediaWikiRevision,
  MediaWikiRevisionSlot,
  ParsedCard,
  ParsedPrinting,
  ParsedPrintingStamp,
  ParsedSet,
  ParsedTemplateBlock,
} from './wiki-types.js';
export type { ParsedCardTitle, ParsedSetTitle } from './parsers/page-title.js';
