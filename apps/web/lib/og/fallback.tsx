// The "generic Binderly-branded" OG card.
//
// Rendered whenever:
//
//   - The handle/slug doesn't resolve.
//   - `is_public=false` (the public Edge endpoint returns 404 in
//     this case; from the route's perspective the payload is null).
//   - The Edge endpoint times out / 5xxes.
//   - The api-client cannot be constructed (build-time / missing
//     env vars on the OG route).
//
// We deliberately ship this as a real branded image rather than a
// 404 because social platforms cache 404s aggressively (every
// minute matters when a brand new shareable goes viral).

import { BRAND, BRAND_BACKGROUND_GRADIENT } from './brand';

export interface FallbackRenderInput {
  /** Echoed back into the subtitle so the unfurl still feels "personal". */
  readonly handle?: string | undefined;
}

export function renderOgFallback(
  input: FallbackRenderInput = {},
): React.ReactElement {
  const subtitle =
    input.handle !== undefined && input.handle.length > 0
      ? `Pokémon collection by @${input.handle}`
      : 'A community of Pokémon collectors';

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '96px',
        backgroundImage: BRAND_BACKGROUND_GRADIENT,
        backgroundColor: BRAND.background,
        color: BRAND.text,
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '24px',
          marginBottom: '32px',
        }}
      >
        <div
          style={{
            display: 'flex',
            width: '88px',
            height: '88px',
            borderRadius: '20px',
            background: BRAND.primary,
            alignItems: 'center',
            justifyContent: 'center',
            color: BRAND.background,
            fontSize: '48px',
            fontWeight: 800,
            letterSpacing: '-1.5px',
          }}
        >
          B
        </div>
        <div
          style={{
            fontSize: '64px',
            fontWeight: 800,
            color: BRAND.text,
            letterSpacing: '-1.5px',
          }}
        >
          Binderly
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          fontSize: '36px',
          color: BRAND.textMuted,
          textAlign: 'center',
          maxWidth: '900px',
        }}
      >
        {subtitle}
      </div>
      <div
        style={{
          display: 'flex',
          marginTop: '48px',
          fontSize: '24px',
          color: BRAND.textDim,
        }}
      >
        binderly.app
      </div>
    </div>
  );
}
