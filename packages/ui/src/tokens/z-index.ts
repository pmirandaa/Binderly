// Z-index layers. Naming matches Chakra / Radix so anyone reading
// the code immediately knows which surface trumps which (a tooltip
// always sits above a toast, a toast above a modal, …).

export const zIndex = {
  hide: -1,
  base: 0,
  raised: 10,
  dropdown: 100,
  sticky: 200,
  banner: 300,
  overlay: 400,
  modal: 500,
  popover: 600,
  toast: 700,
  tooltip: 800,
} as const;

export type ZIndexToken = keyof typeof zIndex;
export type ZIndexValue = (typeof zIndex)[ZIndexToken];

/** Strict ordering used by the monotonicity assertion. */
export const Z_INDEX_ORDER: readonly ZIndexToken[] = [
  'hide',
  'base',
  'raised',
  'dropdown',
  'sticky',
  'banner',
  'overlay',
  'modal',
  'popover',
  'toast',
  'tooltip',
];
