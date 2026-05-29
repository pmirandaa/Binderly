// `@binderly/ui` — public barrel.
//
// External consumers (web, mobile) import from this entry point.
// Deep imports such as `@binderly/ui/components/button` are NOT
// part of the public surface; tree-shaking handles dead-code
// elimination.
//
// Modules are organized by concern — see the README for the
// taxonomy and elaboration decisions.

export * from './tokens/index.js';
export * from './theme/index.js';

export { tamaguiConfig } from './config.js';
export type { TamaguiConfig } from './config.js';

export { THEME_NAMES, UIProvider } from './provider/ui-provider.js';
export type { ThemeName, UIProviderProps } from './provider/ui-provider.js';

export { Box } from './components/box.js';
export type { BoxProps } from './components/box.js';

export { Stack, XStack, YStack } from './components/stack.js';
export type { StackProps, XStackProps, YStackProps } from './components/stack.js';

export { TEXT_VARIANT_FONT_SIZE, TEXT_VARIANT_NAMES, Text } from './components/text.js';
export type { TextProps, TextTone, TextVariant } from './components/text.js';

export { Pressable } from './components/pressable.js';
export type { PressableProps } from './components/pressable.js';

export { BUTTON_SIZES, BUTTON_SIZE_METRICS, BUTTON_VARIANTS, Button } from './components/button.js';
export type { ButtonProps, ButtonSize, ButtonVariant } from './components/button.js';

export { CARD_VARIANTS, Card } from './components/card.js';
export type { CardProps, CardVariant } from './components/card.js';

export { INPUT_SIZES, INPUT_SIZE_METRICS, Input } from './components/input.js';
export type { InputProps, InputSize } from './components/input.js';

export { Modal } from './components/modal.js';
export type { ModalProps } from './components/modal.js';

export { SPINNER_SIZE_PX, Spinner } from './components/spinner.js';
export type { SpinnerProps } from './components/spinner.js';

export { ICON_SIZES, ICON_SIZE_PX, Icon } from './components/icon.js';
export type { IconProps, IconRendererProps, IconSize } from './components/icon.js';
