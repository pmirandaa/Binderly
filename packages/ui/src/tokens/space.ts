// Spacing scale — px-aligned, indexed by Tamagui-style number keys
// (`$0`, `$1`, `$2`, …) so `<XStack space="$3">` reads naturally to
// anyone used to Tamagui / Tailwind / Chakra.
//
// The scale is monotone (asserted in the test). Two odd values
// (`$0.5` and `$1.5`) are intentional — they cover the
// "between 1 and 2" gap that most icon-text pairs need without
// forcing a breakpoint on the rest of the scale.

export const space = {
  $0: 0,
  '$0.5': 2,
  $1: 4,
  '$1.5': 6,
  $2: 8,
  $3: 12,
  $4: 16,
  $5: 20,
  $6: 24,
  $8: 32,
  $10: 40,
  $12: 48,
  $16: 64,
  $20: 80,
  $24: 96,
} as const;

export type SpaceToken = keyof typeof space;
export type SpaceValue = (typeof space)[SpaceToken];

/** Stable ordering for the size-monotonicity assertion. */
export const SPACE_ORDER: readonly SpaceToken[] = [
  '$0',
  '$0.5',
  '$1',
  '$1.5',
  '$2',
  '$3',
  '$4',
  '$5',
  '$6',
  '$8',
  '$10',
  '$12',
  '$16',
  '$20',
  '$24',
];
