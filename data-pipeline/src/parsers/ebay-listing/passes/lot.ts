// Lot / multi-card / sealed-pack detection.
//
// Lots are NOT single-card pricing observations. Downstream
// (`T-DL-PRICING-EBAY-BROWSE`, `T-DL-PRICING-AGGREGATOR`) drops them
// before writing `price_observation` rows — but the parser still
// flags them so we can:
//
//   - Build accurate ingest-side metrics ("how many crawled listings
//     are lots?").
//   - Surface them as low-confidence parse output (the joiner
//     short-circuits on `isLot`).
//
// False positives matter MORE than false negatives here. A misflagged
// single-card listing degrades the pricing time series; a missed lot
// just adds noise. We tune the regex set conservatively and require
// strong signals.

export interface LotMatch {
  readonly isLot: boolean;
  readonly lotSize: number | null;
  readonly remaining: string;
  readonly signals: readonly string[];
}

interface LotPattern {
  readonly re: RegExp;
  readonly label: string;
  /** When the regex captures a count, return it. Else null. */
  readonly extractSize: (m: RegExpExecArray) => number | null;
}

const SIZE_FROM_GROUP = (groupName: string) => (m: RegExpExecArray) => {
  const v = m.groups?.[groupName];
  if (!v) return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const NO_SIZE = () => null;

// Order matters — patterns are tried in declaration order; first hit
// wins for the lot-size capture. A title that says "Lot of 50 Pokemon
// Cards" should match the most specific pattern first.
const LOT_PATTERNS: readonly LotPattern[] = [
  {
    re: /\blot\s+of\s+(?<n>\d+)\b/,
    label: 'lot:of-n',
    extractSize: SIZE_FROM_GROUP('n'),
  },
  // "100x Pokemon" / "100 x Pokemon" — require ≥2-digit count so
  // "4x" inside "4x102" or numeric tokens elsewhere don't fire.
  {
    re: /\b(?<n>\d{2,5})\s*x\s+(?:pok[eé]mon|cards|holos)\b/,
    label: 'lot:n-times',
    extractSize: SIZE_FROM_GROUP('n'),
  },
  // "(50) Pokemon Cards" / "50 cards" — require plural lot-noun so
  // "1999 holo" / "100 card" / year+singular don't match.
  {
    re: /\b(?<n>\d{2,5})\s+(?:cards|pieces|pcs|count)\b/,
    label: 'lot:n-cards',
    extractSize: SIZE_FROM_GROUP('n'),
  },
  // "Pokemon Card Lot" anchored on "lot" without "of N"
  {
    re: /\bcard\s+lot\b/,
    label: 'lot:card-lot',
    extractSize: NO_SIZE,
  },
  {
    re: /\bbulk\s+lot\b/,
    label: 'lot:bulk',
    extractSize: NO_SIZE,
  },
  {
    re: /\bcomplete\s+(?:master\s+)?set\b/,
    label: 'lot:complete-set',
    extractSize: NO_SIZE,
  },
  {
    re: /\bbinder\s+(?:lot|of|full)\b/,
    label: 'lot:binder',
    extractSize: NO_SIZE,
  },
  {
    re: /\bbooster\s+(?:pack|box|bundle|case)\b/,
    label: 'lot:sealed-product',
    extractSize: NO_SIZE,
  },
  {
    re: /\belite\s+trainer\s+box\b/,
    label: 'lot:etb',
    extractSize: NO_SIZE,
  },
  {
    re: /\b(?:sealed|factory\s+sealed)\s+(?:pack|box|booster|product)\b/,
    label: 'lot:sealed',
    extractSize: NO_SIZE,
  },
  // Standalone "wholesale" / "bulk" only flag a lot when paired with a
  // count-ish word elsewhere in the title — the variants `\bbulk\b`
  // and `\bwholesale\b` alone are too risky (e.g. "Charizard Bulk
  // Booster" is sealed).
];

function redactRange(s: string, start: number, end: number): string {
  return s.slice(0, start) + ' '.repeat(end - start) + s.slice(end);
}

/**
 * Detect lot / multi-card / sealed-product signals. Returns
 * `isLot: false` when no pattern matches; `isLot: true` with
 * `lotSize` set when a count was captured.
 */
export function detectLot(working: string): LotMatch {
  let isLot = false;
  let lotSize: number | null = null;
  const signals: string[] = [];
  let remaining = working;

  for (const pat of LOT_PATTERNS) {
    const m = pat.re.exec(remaining);
    if (!m || m.index === undefined) continue;
    isLot = true;
    signals.push(pat.label);
    const size = pat.extractSize(m);
    if (size != null && lotSize == null) {
      lotSize = size;
    }
    remaining = redactRange(remaining, m.index, m.index + m[0].length);
  }

  return { isLot, lotSize, remaining, signals };
}
