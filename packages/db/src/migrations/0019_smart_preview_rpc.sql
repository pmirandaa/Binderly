-- T-BE-Q013-CLEANUP / Surface 2 (`T-BE-SMART-PREVIEW-RPC`, #FU-27).
--
-- Land the Postgres RPC that powers `POST /v1/smart-collections/
-- preview`. The iter-21 preview handler ran the Smart Collection
-- DSL evaluator in-memory in the Edge bundle (it couldn't import
-- `@binderly/smart-collection-dsl` because the Edge import-map is
-- `npm:`-only, and supabase-js has no raw-SQL escape hatch). This
-- migration moves the evaluation server-side as a Postgres
-- function that:
--
--   1. Accepts the DSL AST as `jsonb` (the same shape
--      `smart_collection_rule.expression` stores).
--   2. Compiles the AST to a SQL WHERE clause via a recursive
--      PL/pgSQL walker that ports `packages/smart-collection-dsl/
--      src/sql.ts`'s `expressionToSql()` faithfully.
--   3. Executes the compiled query against the catalog joined to
--      the caller's `collection_item` rows (so `collection.*`
--      predicates work — the iter-21 schema rejected them).
--   4. Returns a window-function `COUNT(*) OVER ()` so the total
--      count comes back in the same round-trip as the page.
--
-- Hand-authored — Drizzle-kit does not model Postgres functions of
-- this complexity (variadic, recursive, EXECUTE-based). Style
-- mirrors `0017_profile_provisioning_trigger.sql`'s SECURITY
-- DEFINER + `SET search_path = ''` posture.
--
-- Migration index `0019` follows the existing 0000–0018 sequence on
-- this branch (`0018_mv_user_completion.sql` ships in the same PR).
--
-- =====================================================================
-- Security model — SECURITY DEFINER + `auth.uid() = p_user_id` guard
-- =====================================================================
--
-- The entry-point function joins `collection_item` (RLS-protected,
-- user-scoped) under SECURITY DEFINER. The DEFINER posture has
-- two reasons:
--
--   1. The function body decides what SQL runs. Even if a caller's
--      session is SECURITY INVOKER-suitable, the function pinning
--      its own user_id parameter into the join makes the access
--      contract explicit at the function boundary.
--   2. A SECURITY DEFINER body can compile and EXECUTE() dynamic
--      SQL with predictable resolution — the empty `search_path`
--      neutralises injection via shadowed schemas.
--
-- The load-bearing guard at the top of the function:
--
--     IF p_user_id IS NULL OR p_user_id <> auth.uid() THEN
--       RAISE EXCEPTION ... USING ERRCODE = '42501';
--     END IF;
--
-- A caller cannot ask for someone else's preview because their JWT
-- subject (`auth.uid()`) must equal the `p_user_id` argument. The
-- handler always passes `session.user.id` here; a malicious caller
-- substituting a different id gets a 42501 envelope (translated by
-- the Edge handler's `translatePostgrestError()` to the canonical
-- AUTH/403 envelope).
--
-- =====================================================================
-- Injection control
-- =====================================================================
--
-- The compiled SQL is built as a single text string and run via
-- `EXECUTE`. The string includes:
--
--   - Hard-coded SQL fragments (SELECT / JOIN / WHERE / ORDER BY /
--     LIMIT / OFFSET).
--   - Column references resolved by the `_smart_column_for(field)`
--     allowlist — only the curated `FIELD_DEFS` keys round-trip to
--     a real column; an unknown field RAISEs.
--   - Value literals quoted via `quote_literal()` (Postgres's
--     SQL-injection-safe primitive). Numbers / booleans are cast
--     via `to_jsonb()` then projected as numeric / boolean text.
--   - Integer bounds `p_limit` / `p_offset` cast to `int` at the
--     PL/pgSQL boundary.
--
-- User-controlled text NEVER reaches the EXECUTE string without
-- going through one of those layers. The
-- `_smart_compile/_smart_column_for/_smart_kind_for/_smart_literal`
-- helpers are deliberately partitioned so a future reviewer can
-- audit the surface in isolation.
--
-- =====================================================================
-- Return shape — single function, window-function count
-- =====================================================================
--
-- The brief named both "sibling count function" and "single-call
-- variant returning a record" — worker chose single-call. Rationale:
--
--   - One round-trip from the Edge handler to PostgREST.
--   - The compiled WHERE clause runs once, not twice; planner sees
--     the same predicate set.
--   - `COUNT(*) OVER ()` is O(matched rows) — no separate aggregate
--     scan. At v1 catalog scale (~30k printings) the cost is
--     bounded.
--
-- Each row carries the same `total_count` value (window function
-- semantics); the handler reads it once off any row (or 0 if the
-- result set is empty — handled by a default in the calling code).

-- =====================================================================
-- 1. Helper: field column allowlist
-- =====================================================================
--
-- Maps a DSL field name (e.g. `card.retreatCost`) to its
-- fully-qualified column reference (`card.retreat_cost`). Raises
-- on unknown fields. The CASE statement is the single source of
-- truth — the only way to reach a real column from caller input.
--
-- Synthetic field `collection.isOwned` maps to
-- `collection_item.id`; the compiler emits `IS NULL` / `IS NOT
-- NULL` predicates on it.

CREATE OR REPLACE FUNCTION public._smart_column_for(field text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  RETURN CASE field
    -- card --
    WHEN 'card.name'                 THEN 'card.name'
    WHEN 'card.number'               THEN 'card.number'
    WHEN 'card.illustrator'          THEN 'card.illustrator'
    WHEN 'card.language'             THEN 'card.language'
    WHEN 'card.type'                 THEN 'card.type'
    WHEN 'card.subtype'              THEN 'card.subtype'
    WHEN 'card.rarity'               THEN 'card.rarity'
    WHEN 'card.hp'                   THEN 'card.hp'
    WHEN 'card.retreatCost'          THEN 'card.retreat_cost'
    -- set --
    WHEN 'set.code'                  THEN 'set_.code'
    WHEN 'set.name'                  THEN 'set_.name'
    WHEN 'set.series'                THEN 'set_.series'
    WHEN 'set.language'              THEN 'set_.language'
    WHEN 'set.releaseDate'           THEN 'set_.release_date'
    WHEN 'set.printedTotal'          THEN 'set_.printed_total'
    WHEN 'set.total'                 THEN 'set_.total'
    -- printing --
    WHEN 'printing.variantClass'     THEN 'printing.variant_class'
    WHEN 'printing.variantFlags'     THEN 'printing.variant_flags'
    WHEN 'printing.variantCode'      THEN 'printing.variant_code'
    WHEN 'printing.includeInMasterSet' THEN 'printing.include_in_master_set'
    -- collection (per-user, LEFT JOINed by the entry point) --
    WHEN 'collection.condition'      THEN 'collection_item.condition'
    WHEN 'collection.gradeCompany'   THEN 'collection_item.grade_company'
    WHEN 'collection.grade'          THEN 'collection_item.grade'
    WHEN 'collection.quantity'       THEN 'collection_item.quantity'
    WHEN 'collection.acquiredAt'     THEN 'collection_item.acquired_at'
    WHEN 'collection.isOwned'        THEN 'collection_item.id'
    ELSE NULL
  END;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public._smart_column_for(text) FROM PUBLIC;
--> statement-breakpoint

-- =====================================================================
-- 2. Helper: field kind allowlist
-- =====================================================================
--
-- Returns `'string' | 'enum' | 'enumArray' | 'number' | 'date' |
-- 'boolean'` per the DSL's `FieldKind` taxonomy. Drives the value
-- coercion in `_smart_literal()` and the operator selection in
-- `_smart_compile()` for `enumArray` fields (which use `ANY(...)`
-- for eq and `&&` for in).

CREATE OR REPLACE FUNCTION public._smart_kind_for(field text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  RETURN CASE field
    -- card --
    WHEN 'card.name'                 THEN 'string'
    WHEN 'card.number'               THEN 'string'
    WHEN 'card.illustrator'          THEN 'string'
    WHEN 'card.language'             THEN 'enum'
    WHEN 'card.type'                 THEN 'enum'
    WHEN 'card.subtype'              THEN 'enum'
    WHEN 'card.rarity'               THEN 'enum'
    WHEN 'card.hp'                   THEN 'number'
    WHEN 'card.retreatCost'          THEN 'number'
    -- set --
    WHEN 'set.code'                  THEN 'string'
    WHEN 'set.name'                  THEN 'string'
    WHEN 'set.series'                THEN 'string'
    WHEN 'set.language'              THEN 'enum'
    WHEN 'set.releaseDate'           THEN 'date'
    WHEN 'set.printedTotal'          THEN 'number'
    WHEN 'set.total'                 THEN 'number'
    -- printing --
    WHEN 'printing.variantClass'     THEN 'enum'
    WHEN 'printing.variantFlags'     THEN 'enumArray'
    WHEN 'printing.variantCode'      THEN 'string'
    WHEN 'printing.includeInMasterSet' THEN 'boolean'
    -- collection --
    WHEN 'collection.condition'      THEN 'enum'
    WHEN 'collection.gradeCompany'   THEN 'enum'
    WHEN 'collection.grade'          THEN 'number'
    WHEN 'collection.quantity'       THEN 'number'
    WHEN 'collection.acquiredAt'     THEN 'date'
    WHEN 'collection.isOwned'        THEN 'boolean'
    ELSE NULL
  END;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public._smart_kind_for(text) FROM PUBLIC;
--> statement-breakpoint

-- =====================================================================
-- 3. Helper: jsonb scalar -> SQL literal
-- =====================================================================
--
-- Converts a jsonb scalar (string / number / boolean) into a safe
-- SQL literal of the appropriate type. Strings round-trip through
-- `quote_literal()` (Postgres's SQL-injection-safe quoting). Numbers
-- are cast to text via jsonb's own numeric serialization. Booleans
-- emit `TRUE` / `FALSE`. Date strings are treated as strings (the
-- column is `date`, so the SQL `=` operator coerces the literal at
-- compare time).
--
-- The `kind` parameter informs the cast but the actual safety is
-- entirely in `quote_literal` — even if a caller asks for kind
-- `number` and supplies a string `'1; DROP TABLE foo'`, we quote
-- the value and Postgres rejects it at compare time with a clean
-- `invalid input syntax for type numeric` error, not as an injected
-- statement.

CREATE OR REPLACE FUNCTION public._smart_literal(value jsonb, kind text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_jsonb_type text;
  v_str text;
BEGIN
  v_jsonb_type := jsonb_typeof(value);

  IF v_jsonb_type = 'null' OR value IS NULL THEN
    RAISE EXCEPTION '_smart_literal: null scalar is not allowed';
  END IF;

  -- enumArray's leaf scalar is a single value; we quote it as a
  -- string (the column type is `text[]`).
  IF kind = 'enumArray' THEN
    IF v_jsonb_type <> 'string' THEN
      RAISE EXCEPTION '_smart_literal: enumArray expects string scalar, got %', v_jsonb_type;
    END IF;
    RETURN quote_literal(value #>> '{}');
  END IF;

  IF kind = 'boolean' THEN
    IF v_jsonb_type <> 'boolean' THEN
      RAISE EXCEPTION '_smart_literal: boolean expects boolean scalar, got %', v_jsonb_type;
    END IF;
    RETURN CASE WHEN (value)::text = 'true' THEN 'TRUE' ELSE 'FALSE' END;
  END IF;

  IF kind = 'number' THEN
    IF v_jsonb_type <> 'number' THEN
      RAISE EXCEPTION '_smart_literal: number expects numeric scalar, got %', v_jsonb_type;
    END IF;
    -- The jsonb numeric serialization is round-trip-safe.
    RETURN (value)::text;
  END IF;

  -- date / enum / string — all quote_literal the unwrapped text.
  IF v_jsonb_type <> 'string' THEN
    RAISE EXCEPTION '_smart_literal: % expects string scalar, got %', kind, v_jsonb_type;
  END IF;
  v_str := value #>> '{}';
  RETURN quote_literal(v_str);
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public._smart_literal(jsonb, text) FROM PUBLIC;
--> statement-breakpoint

-- =====================================================================
-- 4. Recursive compiler: AST -> SQL WHERE-fragment
-- =====================================================================
--
-- Mirror of `expressionToSql()` in `packages/smart-collection-dsl/
-- src/sql.ts`. Every leaf is wrapped in `(... ) IS TRUE` so the
-- evaluator's NULL semantics match the SQL semantics — a NULL
-- column operand collapses the leaf to FALSE before the surrounding
-- NOT / AND / OR sees it.
--
-- Combinators (`and` / `or` / `not`) recurse. Leaves compile per
-- their `type` discriminator:
--
--   - eq:    `(col = literal) IS TRUE`, or for enumArray:
--            `(literal = ANY(col)) IS TRUE`.
--   - in:    `(col IN (lit, lit, ...)) IS TRUE`, or for enumArray:
--            `(col && ARRAY[lit, ...]::text[]) IS TRUE`.
--   - range: `(col >= lit AND col <= lit) IS TRUE` (inclusive bounds
--            by default; minInclusive/maxInclusive toggle to >/<).
--   - exists:`col IS NOT NULL` / `col IS NULL`.
--
-- Synthetic `collection.isOwned` collapses to `IS NULL` / `IS NOT
-- NULL` on `collection_item.id` (the LEFT JOIN's match column).

CREATE OR REPLACE FUNCTION public._smart_compile(node jsonb)
RETURNS text
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_type text;
  v_field text;
  v_col text;
  v_kind text;
  v_value jsonb;
  v_values jsonb;
  v_min jsonb;
  v_max jsonb;
  v_min_inclusive boolean;
  v_max_inclusive boolean;
  v_exists boolean;
  v_child jsonb;
  v_children jsonb;
  v_parts text[];
  v_item jsonb;
  v_min_op text;
  v_max_op text;
  v_range_parts text[];
BEGIN
  IF node IS NULL OR jsonb_typeof(node) <> 'object' THEN
    RAISE EXCEPTION '_smart_compile: expected jsonb object node, got %',
      coalesce(jsonb_typeof(node), 'null');
  END IF;

  v_type := node->>'type';
  IF v_type IS NULL THEN
    RAISE EXCEPTION '_smart_compile: node missing "type" key';
  END IF;

  -- ---- combinators ----------------------------------------------------
  IF v_type = 'and' THEN
    v_children := node->'children';
    IF v_children IS NULL OR jsonb_typeof(v_children) <> 'array'
       OR jsonb_array_length(v_children) = 0 THEN
      RAISE EXCEPTION '_smart_compile: "and" requires non-empty children';
    END IF;
    v_parts := ARRAY[]::text[];
    FOR v_item IN SELECT jsonb_array_elements(v_children) LOOP
      v_parts := array_append(v_parts, public._smart_compile(v_item));
    END LOOP;
    RETURN '(' || array_to_string(v_parts, ' AND ') || ')';
  END IF;

  IF v_type = 'or' THEN
    v_children := node->'children';
    IF v_children IS NULL OR jsonb_typeof(v_children) <> 'array'
       OR jsonb_array_length(v_children) = 0 THEN
      RAISE EXCEPTION '_smart_compile: "or" requires non-empty children';
    END IF;
    v_parts := ARRAY[]::text[];
    FOR v_item IN SELECT jsonb_array_elements(v_children) LOOP
      v_parts := array_append(v_parts, public._smart_compile(v_item));
    END LOOP;
    RETURN '(' || array_to_string(v_parts, ' OR ') || ')';
  END IF;

  IF v_type = 'not' THEN
    v_child := node->'child';
    IF v_child IS NULL THEN
      RAISE EXCEPTION '_smart_compile: "not" requires a child';
    END IF;
    RETURN '(NOT ' || public._smart_compile(v_child) || ')';
  END IF;

  -- ---- leaves ---------------------------------------------------------
  v_field := node->>'field';
  IF v_field IS NULL THEN
    RAISE EXCEPTION '_smart_compile: leaf node "%" missing "field"', v_type;
  END IF;

  v_col := public._smart_column_for(v_field);
  IF v_col IS NULL THEN
    RAISE EXCEPTION '_smart_compile: unknown field "%"', v_field;
  END IF;

  v_kind := public._smart_kind_for(v_field);
  IF v_kind IS NULL THEN
    RAISE EXCEPTION '_smart_compile: missing kind for field "%"', v_field;
  END IF;

  -- ---- eq -------------------------------------------------------------
  IF v_type = 'eq' THEN
    v_value := node->'value';
    IF v_value IS NULL OR jsonb_typeof(v_value) = 'null' THEN
      RAISE EXCEPTION '_smart_compile: "eq" leaf missing "value"';
    END IF;

    -- collection.isOwned is synthetic — true = "owned" = id IS NOT
    -- NULL; false = "not owned" = id IS NULL.
    IF v_field = 'collection.isOwned' THEN
      IF jsonb_typeof(v_value) <> 'boolean' THEN
        RAISE EXCEPTION '_smart_compile: collection.isOwned expects boolean value';
      END IF;
      RETURN CASE
        WHEN (v_value)::text = 'true' THEN '(' || v_col || ' IS NOT NULL)'
        ELSE '(' || v_col || ' IS NULL)'
      END;
    END IF;

    IF v_kind = 'enumArray' THEN
      RETURN '((' || public._smart_literal(v_value, v_kind) || ' = ANY(' || v_col || ')) IS TRUE)';
    END IF;

    RETURN '((' || v_col || ' = ' || public._smart_literal(v_value, v_kind) || ') IS TRUE)';
  END IF;

  -- ---- in -------------------------------------------------------------
  IF v_type = 'in' THEN
    v_values := node->'values';
    IF v_values IS NULL OR jsonb_typeof(v_values) <> 'array'
       OR jsonb_array_length(v_values) = 0 THEN
      RAISE EXCEPTION '_smart_compile: "in" requires non-empty values';
    END IF;

    IF v_field = 'collection.isOwned' THEN
      DECLARE
        v_wants_true boolean := false;
        v_wants_false boolean := false;
      BEGIN
        FOR v_item IN SELECT jsonb_array_elements(v_values) LOOP
          IF jsonb_typeof(v_item) <> 'boolean' THEN
            RAISE EXCEPTION '_smart_compile: collection.isOwned expects boolean values';
          END IF;
          IF (v_item)::text = 'true' THEN
            v_wants_true := true;
          ELSE
            v_wants_false := true;
          END IF;
        END LOOP;
        IF v_wants_true AND v_wants_false THEN
          RETURN 'TRUE';
        ELSIF v_wants_true THEN
          RETURN '(' || v_col || ' IS NOT NULL)';
        ELSIF v_wants_false THEN
          RETURN '(' || v_col || ' IS NULL)';
        ELSE
          RETURN 'FALSE';
        END IF;
      END;
    END IF;

    v_parts := ARRAY[]::text[];
    FOR v_item IN SELECT jsonb_array_elements(v_values) LOOP
      v_parts := array_append(v_parts, public._smart_literal(v_item, v_kind));
    END LOOP;
    IF v_kind = 'enumArray' THEN
      RETURN '((' || v_col || ' && ARRAY[' || array_to_string(v_parts, ', ') ||
             ']::text[]) IS TRUE)';
    END IF;
    RETURN '((' || v_col || ' IN (' || array_to_string(v_parts, ', ') || ')) IS TRUE)';
  END IF;

  -- ---- range ----------------------------------------------------------
  IF v_type = 'range' THEN
    v_min := node->'min';
    v_max := node->'max';
    IF (v_min IS NULL OR jsonb_typeof(v_min) = 'null')
       AND (v_max IS NULL OR jsonb_typeof(v_max) = 'null') THEN
      RAISE EXCEPTION '_smart_compile: "range" requires at least one of min/max';
    END IF;

    v_min_inclusive := COALESCE((node->>'minInclusive')::boolean, true);
    v_max_inclusive := COALESCE((node->>'maxInclusive')::boolean, true);
    v_min_op := CASE WHEN v_min_inclusive THEN '>=' ELSE '>' END;
    v_max_op := CASE WHEN v_max_inclusive THEN '<=' ELSE '<' END;

    v_range_parts := ARRAY[]::text[];
    IF v_min IS NOT NULL AND jsonb_typeof(v_min) <> 'null' THEN
      v_range_parts := array_append(
        v_range_parts,
        '(' || v_col || ' ' || v_min_op || ' ' ||
          public._smart_literal(v_min, v_kind) || ')'
      );
    END IF;
    IF v_max IS NOT NULL AND jsonb_typeof(v_max) <> 'null' THEN
      v_range_parts := array_append(
        v_range_parts,
        '(' || v_col || ' ' || v_max_op || ' ' ||
          public._smart_literal(v_max, v_kind) || ')'
      );
    END IF;
    RETURN '((' || array_to_string(v_range_parts, ' AND ') || ') IS TRUE)';
  END IF;

  -- ---- exists ---------------------------------------------------------
  IF v_type = 'exists' THEN
    v_exists := COALESCE((node->>'exists')::boolean, true);
    RETURN CASE
      WHEN v_exists THEN '(' || v_col || ' IS NOT NULL)'
      ELSE '(' || v_col || ' IS NULL)'
    END;
  END IF;

  RAISE EXCEPTION '_smart_compile: unknown node type "%"', v_type;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public._smart_compile(jsonb) FROM PUBLIC;
--> statement-breakpoint

-- =====================================================================
-- 5. Entry point: smart_collection_preview
-- =====================================================================
--
-- The function the Edge handler invokes via
-- `supabase.rpc('smart_collection_preview', { ast, p_user_id,
--   p_limit, p_offset })`. Returns one row per matching printing
-- + `total_count` window aggregate. The handler reads `total_count`
-- off any row (they all carry the same value).
--
-- SECURITY DEFINER + `auth.uid() = p_user_id` guard — see the
-- header section "Security model". `SET search_path = ''` +
-- fully-qualified table refs neutralise schema-shadowing attacks.
--
-- Pagination posture:
--
--   - p_limit clamped at [1, 500] (matches the contract's max
--     page size).
--   - p_offset must be >= 0.
--   - ORDER BY (`set.release_date` DESC, `card.number` ASC) is
--     stable enough for the preview's row ordering (new sets first,
--     within a set the card number is lexicographic — same posture
--     as the iter-21 in-JS sort).

CREATE OR REPLACE FUNCTION public.smart_collection_preview(
  ast jsonb,
  p_user_id uuid,
  p_limit int DEFAULT 200,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  printing_id uuid,
  card_id uuid,
  set_id uuid,
  card_name text,
  card_number text,
  set_name text,
  set_code text,
  variant_class text,
  variant_flags text[],
  image_small_url text,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_where text;
  v_sql text;
  v_limit int;
  v_offset int;
BEGIN
  -- Guard: only authenticated callers, and only against their own
  -- user_id. A malicious or buggy caller passing someone else's id
  -- gets a 42501 envelope (Edge handler translates to AUTH/403).
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'smart_collection_preview: p_user_id is required'
      USING ERRCODE = '42501';
  END IF;
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'smart_collection_preview: p_user_id must equal auth.uid()'
      USING ERRCODE = '42501';
  END IF;

  v_limit := COALESCE(p_limit, 200);
  IF v_limit < 1 OR v_limit > 500 THEN
    RAISE EXCEPTION 'smart_collection_preview: p_limit must be in [1, 500], got %', v_limit
      USING ERRCODE = '22023';
  END IF;
  v_offset := COALESCE(p_offset, 0);
  IF v_offset < 0 THEN
    RAISE EXCEPTION 'smart_collection_preview: p_offset must be >= 0, got %', v_offset
      USING ERRCODE = '22023';
  END IF;

  IF ast IS NULL OR jsonb_typeof(ast) <> 'object' THEN
    RAISE EXCEPTION 'smart_collection_preview: ast must be a jsonb object, got %',
      coalesce(jsonb_typeof(ast), 'null') USING ERRCODE = '22023';
  END IF;

  -- Compile the AST to a SQL WHERE-clause fragment. The compiler
  -- raises on unknown fields / malformed nodes — those bubble out
  -- as the caller-visible 'P0001' error which the Edge handler
  -- maps to a VALIDATION envelope.
  v_where := public._smart_compile(ast);

  -- Build + execute the projection query. The LEFT JOIN to
  -- `collection_item` filtered by `p_user_id` is what makes
  -- `collection.*` predicates work: the join exposes the user's
  -- per-printing collection row, which the compiled SQL references
  -- via the `collection_item.*` columns the allowlist maps to.
  v_sql :=
    'SELECT
       printing.id::uuid                     AS printing_id,
       card.id::uuid                         AS card_id,
       set_.id::uuid                         AS set_id,
       card.name::text                       AS card_name,
       card.number::text                     AS card_number,
       set_.name::text                       AS set_name,
       set_.code::text                       AS set_code,
       printing.variant_class::text          AS variant_class,
       printing.variant_flags::text[]        AS variant_flags,
       printing.image_small_url::text        AS image_small_url,
       (COUNT(*) OVER ())::bigint            AS total_count
     FROM public.printing AS printing
     JOIN public.card AS card ON card.id = printing.card_id
     JOIN public."set" AS set_ ON set_.id = card.set_id
     LEFT JOIN public.collection_item AS collection_item
       ON  collection_item.printing_id = printing.id
       AND collection_item.user_id = ' || quote_literal(p_user_id::text) || '::uuid
     WHERE ' || v_where || '
     ORDER BY set_.release_date DESC, card.number ASC
     LIMIT '  || v_limit::text || '
     OFFSET ' || v_offset::text;

  RETURN QUERY EXECUTE v_sql;
END;
$$;
--> statement-breakpoint

-- =====================================================================
-- 6. Access posture (REVOKE / GRANT)
-- =====================================================================
--
-- The entry point is the only thing end-user roles can EXECUTE.
-- The helper functions stay PUBLIC-REVOKEd (defense in depth — a
-- caller who somehow wired their PostgREST client to invoke
-- `_smart_compile` directly would still need EXECUTE on it, which
-- nobody has).

REVOKE ALL ON FUNCTION public.smart_collection_preview(jsonb, uuid, int, int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.smart_collection_preview(jsonb, uuid, int, int)
  TO authenticated, service_role;
