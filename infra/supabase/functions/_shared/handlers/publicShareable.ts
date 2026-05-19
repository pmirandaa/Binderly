// Handler for `GET /v1/c/{handle}/{slug}`.
//
// Anonymous endpoint — no JWT required. Resolves the public render
// payload for the SSR `/c/{handle}/{slug}` page declared in
// `apps/web/lib/share/api.ts` (`PublicSharePayload`). Closes Q-012.
//
// Two response shapes share the same URL, gated by the `Accept`
// header:
//
//   - default (`Accept: */*` or `application/json`) — returns the bare
//     `shareableDto` envelope. This is the legacy behavior the
//     existing api-client `shareables.getPublicShareable` calls
//     expect; we don't break callers that already SSR'd against it.
//   - `application/vnd.binderly.share+json` — returns the richer
//     `publicShareableDto` shape: owner, counts, members,
//     description, lastUpdatedAt. The new
//     `shareables.getPublicShareablePayload` client method sends
//     this header.
//
// Access posture. The endpoint uses the SERVICE-ROLE client — RLS
// already allows anon SELECT on `profile` and `shareable` (per
// migrations 0001 / 0005), but anon is REVOKED on `collection_item`,
// `card`, `printing`, `set`'s denormalized join surface. The
// service-role client bypasses RLS so we can build the member grid;
// the handler is intentionally narrow about which columns it
// projects so no `user_id` / `acquired_price` / `notes` etc. ever
// reach the wire. The DB does NOT see the caller's auth context —
// this is a cookie-less public read by design.
//
// Member resolution rules:
//
//   - `target.kind === 'full'` — every `collection_item` row for
//     the owner contributes one member entry. Distinct printings
//     are dedup'd; `quantity` sums across condition / grade rows.
//   - `target.kind === 'custom'` — the member grid is the
//     `custom_collection_item` membership list (in `added_at`
//     order); `quantity` reads from the owner's `collection_item`
//     row for each printing (0 if the owner doesn't own that
//     printing yet — the "missing" / "owned" UI mode the
//     `showMissing` shareable flag toggles).
//
// Members are capped at 500 to keep the SSR payload bounded. The
// frontend pagination story is deferred to a follow-up (see
// `apps/web/lib/share/api.ts` comment); for now the SSR HTML
// renders up to 500, the owner's view shows everything.

import { ApiError, apiOk } from '../errors.ts';
import { createServiceRoleClient, translatePostgrestError } from '../db.ts';

import type { CorsConfig } from '../cors.ts';
import type { ClientFactoryDeps, EdgeFunctionEnv } from '../db.ts';
import type { RouteMatch } from '../routing.ts';

export interface HandlerContext {
  readonly env: EdgeFunctionEnv;
  readonly cors: CorsConfig;
  readonly requestId: string;
  readonly deps?: ClientFactoryDeps;
}

const SHARE_ACCEPT = 'application/vnd.binderly.share+json';
const MAX_MEMBERS = 500;

interface ProfileRow {
  readonly user_id: string;
  readonly handle: string;
  readonly display_name: string | null;
  readonly avatar_url: string | null;
  readonly bio: string | null;
}

interface ShareableRow {
  readonly id: string;
  readonly user_id: string;
  readonly slug: string;
  readonly target: unknown;
  readonly theme: string;
  readonly show_values: boolean;
  readonly show_missing: boolean;
  readonly show_photos: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

interface CollectionItemRow {
  readonly id: string;
  readonly user_id: string;
  readonly printing_id: string;
  readonly quantity: number;
  readonly updated_at: string;
}

interface CustomCollectionRow {
  readonly id: string;
  readonly user_id: string;
  readonly name: string;
  readonly description: string | null;
}

interface CustomCollectionItemRow {
  readonly custom_collection_id: string;
  readonly printing_id: string;
  readonly added_at: string;
}

interface PrintingRow {
  readonly id: string;
  readonly card_id: string;
  readonly variant_class: string;
  readonly variant_code: string;
  readonly variant_flags: readonly string[];
  readonly image_small_url: string | null;
  readonly include_in_master_set: boolean;
}

interface CardRow {
  readonly id: string;
  readonly set_id: string;
  readonly name: string;
  readonly number: string;
}

interface SetRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

interface ShareableWire {
  id: string;
  userId: string;
  slug: string;
  target: unknown;
  theme: string;
  showValues: boolean;
  showMissing: boolean;
  showPhotos: boolean;
  createdAt: string;
  updatedAt: string;
}

interface PublicShareMemberWire {
  printingId: string;
  cardId: string;
  cardName: string;
  cardNumber: string;
  setName: string;
  setCode: string;
  variantLabel: string;
  imageUrl: string | null;
  quantity: number;
}

interface PublicShareableWire {
  shareable: ShareableWire;
  owner: {
    handle: string;
    displayName: string | null;
    avatarUrl: string | null;
    bio: string | null;
  };
  collectionTitle: string;
  description: string | null;
  counts: {
    ownedUnique: number;
    ownedTotalQuantity: number;
    catalogTotal: number;
    completionPct: number;
  };
  members: readonly PublicShareMemberWire[];
  lastUpdatedAt: string;
}

export async function handleGetPublicShareable(
  request: Request,
  match: RouteMatch,
  ctx: HandlerContext,
): Promise<Response> {
  const handle = match.params['handle'];
  const slug = match.params['slug'];
  if (handle === undefined || handle.length === 0) {
    throw new ApiError('VALIDATION', 'Missing :handle path parameter.');
  }
  if (slug === undefined || slug.length === 0) {
    throw new ApiError('VALIDATION', 'Missing :slug path parameter.');
  }

  // Service-role client — anonymous endpoint, no JWT in the request,
  // no `requireUser()` call. RLS would gate `collection_item` and
  // the join targets; we bypass to read the public-facing projection
  // ourselves.
  const supabase = createServiceRoleClient(ctx.env, ctx.deps);

  // 1) Resolve handle → profile row. `profile.handle` is `citext` so
  //    the comparison is case-insensitive at the DB level.
  const { data: profileData, error: profileError } = await supabase
    .from('profile')
    .select('user_id, handle, display_name, avatar_url, bio')
    .eq('handle', handle)
    .maybeSingle();
  if (profileError !== null) throw translatePostgrestError(profileError);
  if (profileData === null) {
    throw new ApiError('NOT_FOUND', `No profile for handle "${handle}".`);
  }
  const profile = profileData as ProfileRow;

  // 2) Resolve (user_id, slug) → shareable row.
  const { data: shareableData, error: shareableError } = await supabase
    .from('shareable')
    .select('*')
    .eq('user_id', profile.user_id)
    .eq('slug', slug)
    .maybeSingle();
  if (shareableError !== null) throw translatePostgrestError(shareableError);
  if (shareableData === null) {
    throw new ApiError('NOT_FOUND', `No shareable "${slug}" for handle "${handle}".`);
  }
  const shareable = shareableData as ShareableRow;

  // 3) Branch on Accept header. The legacy api-client method asks
  //    for `application/json` (or sends no Accept at all) and gets
  //    the bare shareable envelope; the new one sends the
  //    binderly.share vendor media type to opt into the richer
  //    payload.
  const acceptHeader = (request.headers.get('accept') ?? '').toLowerCase();
  const wantsRichPayload = acceptHeader.includes(SHARE_ACCEPT);

  const shareableWire = shareableRowToWire(shareable);
  if (!wantsRichPayload) {
    return apiOk(request, ctx.cors, ctx.requestId, shareableWire);
  }

  // 4) Build the rich payload. The DB queries here are the load-
  //    bearing work and live in `buildPublicSharePayload`.
  const richPayload = await buildPublicSharePayload(supabase, profile, shareable, shareableWire);
  return apiOk(request, ctx.cors, ctx.requestId, richPayload);
}

function shareableRowToWire(row: ShareableRow): ShareableWire {
  return {
    id: row.id,
    userId: row.user_id,
    slug: row.slug,
    target: row.target,
    theme: row.theme,
    showValues: row.show_values,
    showMissing: row.show_missing,
    showPhotos: row.show_photos,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function buildPublicSharePayload(
  supabase: ReturnType<typeof createServiceRoleClient>,
  profile: ProfileRow,
  shareable: ShareableRow,
  shareableWire: ShareableWire,
): Promise<PublicShareableWire> {
  const target = parseTarget(shareable.target);

  // 4a) Determine the member roster. `full` reads every owned
  //     printing; `custom` reads the `custom_collection_item` list
  //     (in `added_at` order) and joins owner quantities.
  let members: PublicShareMemberWire[];
  let catalogTotal: number;
  let collectionTitle: string;
  let description: string | null;
  let lastUpdatedAt: string;

  if (target.kind === 'full') {
    const { data: ownedRows, error: ownedError } = await supabase
      .from('collection_item')
      .select('id, user_id, printing_id, quantity, updated_at')
      .eq('user_id', profile.user_id);
    if (ownedError !== null) throw translatePostgrestError(ownedError);
    const owned = (ownedRows ?? []) as readonly CollectionItemRow[];

    const quantityByPrinting = sumQuantitiesByPrinting(owned);
    const printingIds = Array.from(quantityByPrinting.keys()).slice(0, MAX_MEMBERS);
    const { printings, cards, sets } = await loadPrintingsCardsSets(supabase, printingIds);

    members = buildMembers(printingIds, printings, cards, sets, quantityByPrinting);

    catalogTotal = await loadCatalogMasterTotal(supabase);
    collectionTitle = formatFullTitle(profile);
    description = null;
    lastUpdatedAt = computeLastUpdatedAt(owned, shareable.updated_at);
  } else {
    const { data: ccData, error: ccError } = await supabase
      .from('custom_collection')
      .select('id, user_id, name, description')
      .eq('id', target.customCollectionId)
      .eq('user_id', profile.user_id)
      .maybeSingle();
    if (ccError !== null) throw translatePostgrestError(ccError);
    if (ccData === null) {
      // The shareable references a custom_collection that's gone
      // (deleted, or doesn't belong to the same owner). Treat as
      // 404 — the public page would render empty, but a clean
      // not-found is the better signal.
      throw new ApiError(
        'NOT_FOUND',
        `Shareable references missing custom_collection ${target.customCollectionId}.`,
      );
    }
    const customCollection = ccData as CustomCollectionRow;

    const { data: ccItemRows, error: ccItemError } = await supabase
      .from('custom_collection_item')
      .select('custom_collection_id, printing_id, added_at')
      .eq('custom_collection_id', customCollection.id)
      .order('added_at', { ascending: true })
      .limit(MAX_MEMBERS);
    if (ccItemError !== null) throw translatePostgrestError(ccItemError);
    const memberPrintingIds = ((ccItemRows ?? []) as readonly CustomCollectionItemRow[]).map(
      (r) => r.printing_id,
    );

    // Owner's quantity per printing in the member roster.
    const { data: ownedRows, error: ownedError } = await supabase
      .from('collection_item')
      .select('id, user_id, printing_id, quantity, updated_at')
      .eq('user_id', profile.user_id)
      .in('printing_id', memberPrintingIds.length > 0 ? memberPrintingIds : ['__none__']);
    if (ownedError !== null) throw translatePostgrestError(ownedError);
    const owned = (ownedRows ?? []) as readonly CollectionItemRow[];
    const quantityByPrinting = sumQuantitiesByPrinting(owned);

    const { printings, cards, sets } = await loadPrintingsCardsSets(supabase, memberPrintingIds);
    members = buildMembers(memberPrintingIds, printings, cards, sets, quantityByPrinting);

    catalogTotal = memberPrintingIds.length;
    collectionTitle = formatCustomTitle(profile, customCollection);
    description = customCollection.description;
    lastUpdatedAt = computeLastUpdatedAt(owned, shareable.updated_at);
  }

  // 4b) Counts.
  const ownedUnique = members.filter((m) => m.quantity > 0).length;
  const ownedTotalQuantity = members.reduce((acc, m) => acc + m.quantity, 0);
  const completionPct =
    catalogTotal > 0 ? Math.round((ownedUnique / catalogTotal) * 10000) / 100 : 0;

  return {
    shareable: shareableWire,
    owner: {
      handle: profile.handle,
      displayName: profile.display_name,
      avatarUrl: profile.avatar_url,
      bio: profile.bio,
    },
    collectionTitle,
    description,
    counts: {
      ownedUnique,
      ownedTotalQuantity,
      catalogTotal,
      completionPct,
    },
    members,
    lastUpdatedAt,
  };
}

type ParsedTarget = { kind: 'full' } | { kind: 'custom'; customCollectionId: string };

function parseTarget(raw: unknown): ParsedTarget {
  if (typeof raw !== 'object' || raw === null) {
    throw new ApiError('INTERNAL', 'shareable.target has unexpected shape.');
  }
  const kind = (raw as { kind?: unknown }).kind;
  if (kind === 'full') return { kind: 'full' };
  if (kind === 'custom') {
    const cid = (raw as { custom_collection_id?: unknown; customCollectionId?: unknown });
    const id = (cid.custom_collection_id ?? cid.customCollectionId) as string | undefined;
    if (typeof id !== 'string' || id.length === 0) {
      throw new ApiError('INTERNAL', 'shareable.target.custom missing custom_collection_id.');
    }
    return { kind: 'custom', customCollectionId: id };
  }
  throw new ApiError('INTERNAL', `Unknown shareable target kind: ${String(kind)}.`);
}

function sumQuantitiesByPrinting(rows: readonly CollectionItemRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.printing_id, (map.get(row.printing_id) ?? 0) + row.quantity);
  }
  return map;
}

async function loadPrintingsCardsSets(
  supabase: ReturnType<typeof createServiceRoleClient>,
  printingIds: readonly string[],
): Promise<{
  printings: readonly PrintingRow[];
  cards: readonly CardRow[];
  sets: readonly SetRow[];
}> {
  if (printingIds.length === 0) {
    return { printings: [], cards: [], sets: [] };
  }
  const { data: printingRows, error: printingError } = await supabase
    .from('printing')
    .select(
      'id, card_id, variant_class, variant_code, variant_flags, image_small_url, include_in_master_set',
    )
    .in('id', printingIds);
  if (printingError !== null) throw translatePostgrestError(printingError);
  const printings = (printingRows ?? []) as readonly PrintingRow[];
  const cardIds = Array.from(new Set(printings.map((p) => p.card_id)));
  const { data: cardRows, error: cardError } = await supabase
    .from('card')
    .select('id, set_id, name, number')
    .in('id', cardIds.length > 0 ? cardIds : ['__none__']);
  if (cardError !== null) throw translatePostgrestError(cardError);
  const cards = (cardRows ?? []) as readonly CardRow[];
  const setIds = Array.from(new Set(cards.map((c) => c.set_id)));
  const { data: setRows, error: setError } = await supabase
    .from('set')
    .select('id, code, name')
    .in('id', setIds.length > 0 ? setIds : ['__none__']);
  if (setError !== null) throw translatePostgrestError(setError);
  const sets = (setRows ?? []) as readonly SetRow[];
  return { printings, cards, sets };
}

async function loadCatalogMasterTotal(
  supabase: ReturnType<typeof createServiceRoleClient>,
): Promise<number> {
  const { data, error } = await supabase
    .from('printing')
    .select('id')
    .eq('include_in_master_set', true);
  if (error !== null) throw translatePostgrestError(error);
  return Array.isArray(data) ? data.length : 0;
}

function buildMembers(
  printingIds: readonly string[],
  printings: readonly PrintingRow[],
  cards: readonly CardRow[],
  sets: readonly SetRow[],
  quantityByPrinting: ReadonlyMap<string, number>,
): PublicShareMemberWire[] {
  const printingsById = new Map(printings.map((p) => [p.id, p]));
  const cardsById = new Map(cards.map((c) => [c.id, c]));
  const setsById = new Map(sets.map((s) => [s.id, s]));
  const out: PublicShareMemberWire[] = [];
  for (const id of printingIds) {
    const printing = printingsById.get(id);
    if (printing === undefined) continue;
    const card = cardsById.get(printing.card_id);
    if (card === undefined) continue;
    const set = setsById.get(card.set_id);
    if (set === undefined) continue;
    out.push({
      printingId: printing.id,
      cardId: card.id,
      cardName: card.name,
      cardNumber: card.number,
      setName: set.name,
      setCode: set.code,
      variantLabel: variantLabel(printing),
      imageUrl: printing.image_small_url,
      quantity: quantityByPrinting.get(id) ?? 0,
    });
  }
  return out;
}

/**
 * Build the human label for a printing's variant. Standardized so
 * SSR and the api-client agree. Empty for the base printing; for
 * non-base printings we surface the `variant_class` (and any flags)
 * since the frontend's existing card-detail render uses the same.
 */
function variantLabel(printing: PrintingRow): string {
  if (printing.variant_class === 'BASE' && printing.variant_flags.length === 0) {
    return '';
  }
  const flags = printing.variant_flags.length > 0 ? ` (${printing.variant_flags.join(', ')})` : '';
  return `${printing.variant_class}${flags}`;
}

function formatFullTitle(profile: ProfileRow): string {
  const name = profile.display_name ?? profile.handle;
  return `${name}'s collection`;
}

function formatCustomTitle(profile: ProfileRow, customCollection: CustomCollectionRow): string {
  const name = profile.display_name ?? profile.handle;
  return `${name}'s ${customCollection.name}`;
}

function computeLastUpdatedAt(
  rows: readonly CollectionItemRow[],
  fallback: string,
): string {
  if (rows.length === 0) return fallback;
  let max = rows[0]!.updated_at;
  for (const row of rows) {
    if (row.updated_at > max) max = row.updated_at;
  }
  return max > fallback ? max : fallback;
}
