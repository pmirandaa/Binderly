// Public barrel for `@binderly/smart-collection-dsl`. Only this
// file is part of the package's public surface — every other
// module is internal and callers must NOT reach into
// `@binderly/smart-collection-dsl/src/<module>`.

export { evaluateExpression } from './evaluate.js';
export { explainExpression } from './explain.js';
export {
  isSmartDslParseError,
  normalize,
  parseExpression,
  safeParseExpression,
  SmartDslParseError,
} from './parse.js';
export {
  DEFAULT_MAX_DEPTH,
  expressionDepth,
  expressionSchema,
  expressionSchemaWithDepth,
} from './schema.js';
export {
  expressionToSql,
  type ExpressionToSqlOptions,
  type ExpressionToSqlResult,
  type SqlAliases,
} from './sql.js';
export {
  FIELD_DEFS,
  FIELDS,
  getFieldDef,
  isField,
  type AndNode,
  type BooleanFieldDef,
  type CandidateCard,
  type CandidateCollection,
  type CandidateItem,
  type CandidatePrinting,
  type CandidateSet,
  type DateFieldDef,
  type EnumArrayFieldDef,
  type EnumFieldDef,
  type EqNode,
  type ExistsNode,
  type Expression,
  type Field,
  type FieldDef,
  type FieldKind,
  type InNode,
  type NotNode,
  type NumberFieldDef,
  type OrNode,
  type RangeBound,
  type RangeNode,
  type ScalarValue,
  type StringFieldDef,
} from './types.js';
