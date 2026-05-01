# Legal & Brand

Practical implementation rules for the IP posture in PROJECT.md § 2.

## What we never do

- Use Pokémon Company logos, fonts, or mascots in our app icon, splash,
  marketing site, store listings, or any branded asset.
- Imply affiliation. No "Official Pokémon TCG tracker", no "Powered by
  TPC", no "Endorsed by".
- Sell merchandise.
- Redistribute card images outside the app (no public API returning card
  art, no embeddable widgets that serve our hosted images to third
  parties).
- Reproduce card text or rules text verbatim when summarized text would
  serve the user (e.g., card detail "Effect" field is OK because it's
  reading the printed card; we don't paraphrase rules into our own
  reference docs).
- Scrape Pokémon Company assets directly (we use TCGdex,
  pokemontcg.io, and similar — they do this and we inherit their
  terms).

## What we always do

- Footer disclaimer (web) and About screen (mobile):
  *"Binderly is not affiliated with, endorsed by, or sponsored by
  Nintendo, Game Freak, Creatures Inc., or The Pokémon Company
  International. All card names, set names, and images are property of
  their respective owners."*
- App store description includes the disclaimer.
- Use "Pokémon" (factually) only where descriptive — "Track your
  Pokémon TCG collection" is fine; "The Pokémon app" is not.
- Provide a "report this card / image / data" flow on every card detail
  page that opens a form posting to a `card_report` table for ops review.
- Maintain an admin kill switch: setting `printing.image_visible = false`
  hides the image globally and substitutes a placeholder. Useful if a
  legitimate complaint arrives.

## Image hosting

- We re-host catalog images on R2 (see PROJECT.md § 2). Originals are
  attributed via `printing.image_source_url` in the data, not the UI.
- User-uploaded photos (`collection_item.photo_urls`,
  `grading_submission.*_url`) live in Supabase Storage with strict RLS
  (only the owner can read).

## Data source ToS

- **TCGdex** — open API, attribution requested. We attribute in the About
  screen.
- **pokemontcg.io** — free tier requires API key; ToS permits commercial
  use. Attribution recommended.
- **Bulbapedia** — CC-BY-NC-SA. Text content cannot be redistributed
  commercially under their license. We use it for *cross-validation* of
  facts, not as a content source for user-facing prose. Where we display
  text plausibly originating from Bulbapedia (set descriptions,
  illustrator names), we treat it as factual data, not copyrighted prose,
  and verify against another source.
- **Serebii / Pokellector** — scraped sparingly, with backoff and
  respect for robots.txt.
- **TCGplayer** — API access closed to new developers (late 2024). We do
  not call any TCGplayer API. **We do not scrape TCGplayer.** Their ToS,
  API terms, and Community Guidelines all explicitly prohibit it
  (including obtaining scraped TCGplayer data from third parties — read
  carefully, this is unusual and important). They use Cloudflare-grade
  bot protection, eBay (their owner) has lawyers, and the API terms
  forbid using their content "to build, enhance, improve or promote a
  similar or competitive website, product, or service" — a Pokémon
  collection tracker plausibly qualifies. Risk-reward is wrong even
  before the technical fight.

  We participate in their **affiliate program** via Impact (open and
  accepting applications) for "Buy on TCGplayer" CTAs. No live API
  calls to api.tcgplayer.com from any environment.

- **Pricing data feeds** (third-party aggregators like TCG API,
  TCGAPIs): these companies scrape TCGplayer themselves and resell the
  data. Using them transfers the legal exposure to them — that's their
  business model. No live calls until a feed is selected and
  `PRICING_ENABLED=true`. Review the chosen provider's ToS before
  flipping the flag (we want to verify they grant a commercial
  redistribution-style license, not just personal use).
- **PSA cert pages** — public data; scraping is grey-zone. We rate limit
  to ≤1 req/sec, identify ourselves with a contactable User-Agent, and
  cache aggressively. If they ToS-block us, we pivot to community-only
  training data.
- **eBay Browse API** — open, free, no approval required. We use this
  for active listings on a daily cron. Requires an eBay Developer Program
  account (free signup).
- **eBay Marketplace Insights API** — required for sold-listing data.
  Restricted, requires business-level approval. Apply when traction
  justifies it; not on the v1 critical path. The Finding API's
  `findCompletedItems` is decommissioned and is not a path forward.
- **PWCC / Goldin** — public archives; rate-limit + cache. Drop on first
  complaint.
- **Cardmarket** — direct API closed to new applications (their official
  help page: "Currently, we are not accepting applications for access to
  the Cardmarket API"). We do not call the Cardmarket API directly.
  Cardmarket pricing reaches us only via the third-party aggregator
  (Layer 1 of the pricing pipeline), which has its own data-source
  arrangement.
- **Pricing aggregators (PokeTrace, pokemon-api.com, similar)** — read
  the chosen provider's ToS and confirm a commercial-use / redistribution
  license before flipping `PRICING_ENABLED=true`. We rely on them for
  eBay sold-listing data and Cardmarket data. Acceptable risk: they take
  on the upstream legal exposure, we pay them for the abstraction.

## App store listings

- iOS: include the disclaimer in the description. Avoid keyword stuffing
  with "Pokémon" — use it factually 1–2 times.
- Android: same.
- Both: never put Pokémon Company assets in screenshots. All screenshots
  feature our UI; if cards appear, they're general game shots that fall
  under nominative use, with the disclaimer.

## Trademark search before launch

A foundation-phase task includes a USPTO + EUIPO + WIPO search for
"Binderly" and similar marks in classes 9 (software) and 35
(advertising/marketing services). If a conflict is found, escalate via
`open-questions.md` before any public branding goes out.

## What an agent should refuse to do

If a task or human instruction asks the agent to:

- Use Pokémon Company logos in any branded asset
- Build features that look like or claim to be official
- Scrape pokemon.com or assets.pokemon.com
- **Scrape TCGplayer (api.tcgplayer.com, tcgplayer.com, or any subdomain), or build features that depend on scraped TCGplayer data — including obtaining such data from third parties who scraped it**
- Implement a public API that returns card images we host
- Add a "trade with other users" or marketplace feature

Stop. Surface to `open-questions.md`. Do not implement.
