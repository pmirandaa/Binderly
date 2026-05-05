// Shadow / elevation tokens. Each tier carries:
//   - `web.boxShadow` — the CSS string a styled component can drop
//     straight into a `box-shadow` prop.
//   - `native.shadow*` — the React Native shadow tuple
//     (color/offset/opacity/radius) plus Android `elevation`.
//
// Components that want elevation reference the token by name
// (e.g. `<Card elevation="md" />`); the component layer picks the
// platform-correct fields.

export interface ShadowSpec {
  readonly web: { readonly boxShadow: string };
  readonly native: {
    readonly shadowColor: string;
    readonly shadowOffset: { readonly width: number; readonly height: number };
    readonly shadowOpacity: number;
    readonly shadowRadius: number;
    readonly elevation: number;
  };
}

const noShadow: ShadowSpec = {
  web: { boxShadow: 'none' },
  native: {
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
};

const xsShadow: ShadowSpec = {
  web: { boxShadow: '0 1px 2px 0 rgba(15, 23, 42, 0.05)' },
  native: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
};

const smShadow: ShadowSpec = {
  web: { boxShadow: '0 1px 3px 0 rgba(15, 23, 42, 0.10), 0 1px 2px -1px rgba(15, 23, 42, 0.10)' },
  native: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
};

const mdShadow: ShadowSpec = {
  web: {
    boxShadow: '0 4px 6px -1px rgba(15, 23, 42, 0.10), 0 2px 4px -2px rgba(15, 23, 42, 0.10)',
  },
  native: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
};

const lgShadow: ShadowSpec = {
  web: {
    boxShadow: '0 10px 15px -3px rgba(15, 23, 42, 0.12), 0 4px 6px -4px rgba(15, 23, 42, 0.10)',
  },
  native: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
    elevation: 8,
  },
};

export const shadows = {
  none: noShadow,
  xs: xsShadow,
  sm: smShadow,
  md: mdShadow,
  lg: lgShadow,
} as const;

export type ShadowToken = keyof typeof shadows;

/** Strict order used by the monotonicity assertion (radius/elevation grow). */
export const SHADOW_ORDER: readonly ShadowToken[] = ['none', 'xs', 'sm', 'md', 'lg'];
