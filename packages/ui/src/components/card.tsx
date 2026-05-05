// `<Card>` — surface primitive. Three visual modes:
//   - `surface` (default) — solid surface, no border, no elevation.
//   - `elevated` — applies the `md` shadow tier (theme-token shadow).
//   - `outlined` — adds a 1px border in the `$border` token.

import { Stack as TamaguiStack, styled } from '@tamagui/core';

import type { ComponentProps } from 'react';

export const CARD_VARIANTS = ['surface', 'elevated', 'outlined'] as const;
export type CardVariant = (typeof CARD_VARIANTS)[number];

export const Card = styled(TamaguiStack, {
  name: 'BinderlyCard',
  backgroundColor: '$surface',
  borderRadius: 12,
  padding: 16,
  variants: {
    variant: {
      surface: {
        backgroundColor: '$surface',
      },
      elevated: {
        backgroundColor: '$surfaceElevated',
        // Web maps these to the `box-shadow` CSS string; native maps
        // them onto RN's shadow* props. The literal numbers here are
        // intentional (the v1 shadow scale) — see `tokens/shadows.ts`
        // for the full table.
        shadowOpacity: 0.12,
        shadowRadius: 8,
      },
      outlined: {
        backgroundColor: '$surface',
        borderWidth: 1,
        borderColor: '$border',
      },
    },
  } as const,
  defaultVariants: {
    variant: 'surface',
  },
});

export type CardProps = ComponentProps<typeof Card>;
