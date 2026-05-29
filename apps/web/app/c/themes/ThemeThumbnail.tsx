// Presentational swatch for the settings theme gallery.
//
// Renders a tiny, decorative preview of a theme — background, a couple
// of text bars in the theme's heading/body colours, and an accent
// chip — so the picker shows *what each theme looks like* rather than
// just a name. Purely visual: `aria-hidden`, no interactivity (the
// surrounding picker button owns the semantics + click target).

import type { Theme } from './registry';
import type { ReactNode } from 'react';

export interface ThemeThumbnailProps {
  readonly theme: Theme;
  readonly selected?: boolean;
  readonly testId?: string;
}

export function ThemeThumbnail({
  theme,
  selected = false,
  testId,
}: ThemeThumbnailProps): ReactNode {
  return (
    <div
      data-testid={testId ?? `theme-thumbnail-${theme.id}`}
      data-selected={selected ? 'true' : 'false'}
      aria-hidden="true"
      style={{
        backgroundColor: theme.palette.background,
        border: `2px solid ${selected ? theme.palette.accent : theme.palette.border}`,
        borderRadius: 10,
        padding: 10,
        width: 104,
        height: 68,
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        boxSizing: 'border-box',
      }}
    >
      {theme.header === 'band' ? (
        <div
          style={{
            height: 5,
            width: '100%',
            backgroundColor: theme.palette.accent,
            borderRadius: 2,
          }}
        />
      ) : null}
      <div
        style={{
          height: 9,
          width: '72%',
          backgroundColor: theme.palette.text,
          borderRadius: 2,
        }}
      />
      <div
        style={{
          height: 6,
          width: '52%',
          backgroundColor: theme.palette.textMuted,
          borderRadius: 2,
        }}
      />
      <div
        style={{
          marginTop: 'auto',
          height: 12,
          width: 30,
          backgroundColor: theme.palette.accent,
          borderRadius: 4,
        }}
      />
    </div>
  );
}
