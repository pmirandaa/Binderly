// `<Input>` — text input with `label`, `helperText`, `errorText`
// slots. Built on Tamagui's `@tamagui/input` primitive (auto-forks
// to a web `<input>` and a native `TextInput`), wrapped in a
// `<YStack>` that composes the slots.
//
// `error` flips the border colour and surfaces `errorText` to
// `aria-describedby`. `helperText` is only rendered when no error is
// present (matches every shipping design system convention).
//
// Implementation note: we deliberately do NOT use `styled(TamaguiInput)`
// here. The `styled()` call returns a TamaguiComponent whose inferred
// type pulls in `react-native` types that aren't portable across the
// `composite: true` declaration boundary (TS2742). Wrapping the
// primitive directly side-steps the issue and keeps the public type
// surface narrow.

import { Stack as TamaguiStack, Text as TamaguiText, styled } from '@tamagui/core';
import { Input as TamaguiInput } from '@tamagui/input';
import { forwardRef, useId, type ReactNode } from 'react';

export const INPUT_SIZES = ['sm', 'md', 'lg'] as const;
export type InputSize = (typeof INPUT_SIZES)[number];

export const INPUT_SIZE_METRICS: Readonly<
  Record<InputSize, { height: number; paddingHorizontal: number; fontSize: number }>
> = {
  sm: { height: 32, paddingHorizontal: 8, fontSize: 14 },
  md: { height: 40, paddingHorizontal: 12, fontSize: 15 },
  lg: { height: 48, paddingHorizontal: 16, fontSize: 16 },
};

const Container = styled(TamaguiStack, {
  name: 'BinderlyInputContainer',
  flexDirection: 'column',
  gap: 4,
});

const Label = styled(TamaguiText, {
  name: 'BinderlyInputLabel',
  color: '$text',
  fontSize: 14,
  fontWeight: '600',
});

const HelperText = styled(TamaguiText, {
  name: 'BinderlyInputHelperText',
  color: '$textMuted',
  fontSize: 12,
});

const ErrorText = styled(TamaguiText, {
  name: 'BinderlyInputErrorText',
  color: '$error',
  fontSize: 12,
});

/**
 * Tamagui's `Input.onChange` is typed as a web `FormEventHandler` &&
 * RN's `TextInputChangeEventData` event handler simultaneously, an
 * intersection no concrete callback can satisfy. We bypass the
 * intersection at the boundary and read the value off the runtime
 * event shape the active platform actually provides.
 */
type ChangeEvt = { target?: { value?: string } } | { nativeEvent?: { text?: string } };

function extractValue(event: ChangeEvt): string {
  const targeted = event as { target?: { value?: string } };
  if (targeted.target && typeof targeted.target.value === 'string') {
    return targeted.target.value;
  }
  const native = event as { nativeEvent?: { text?: string } };
  if (native.nativeEvent && typeof native.nativeEvent.text === 'string') {
    return native.nativeEvent.text;
  }
  return '';
}

export interface InputProps {
  /** Text-input value. */
  value?: string;
  /** Default value (uncontrolled). */
  defaultValue?: string;
  /** Change handler. Suppressed when `disabled === true`. */
  onChangeText?: (next: string) => void;
  /**
   * Blur handler. Fires on web `blur` and native `onBlur`. Surfaced
   * as a no-arg callback (cross-platform); read the current value
   * from your controlled `value` / `onChangeText` state.
   */
  onBlur?: () => void;
  /**
   * End-of-editing handler. Fires on native `onEndEditing` (submit /
   * blur after edit); on web it is wired to the underlying primitive's
   * blur so callers get the same "user finished editing" signal on
   * both platforms. Receives the input's current string value.
   */
  onEndEditing?: (next: string) => void;
  /** Size — see `INPUT_SIZES`. */
  size?: InputSize;
  /** Disable the input; sets `aria-disabled` + `accessibilityState`. */
  disabled?: boolean;
  /** Error state — flips border colour, exposes `errorText`. */
  error?: boolean;
  /** Optional label rendered above the input. */
  label?: ReactNode;
  /** Optional helper text below the input. Hidden when `errorText` is shown. */
  helperText?: ReactNode;
  /** Error message rendered below the input when `error === true`. */
  errorText?: ReactNode;
  /** Web a11y label (used when no visible `label` is supplied). */
  'aria-label'?: string;
  /** RN a11y label. */
  accessibilityLabel?: string;
  /** Placeholder text. */
  placeholder?: string;
  /** HTML `name` (web only). */
  name?: string;
  /** HTML `id` (web only). Auto-generated if not provided. */
  id?: string;
  /** Test id (forwarded to underlying primitive). */
  testID?: string;
}

const SIZE_HEIGHT: Record<InputSize, number> = {
  sm: INPUT_SIZE_METRICS.sm.height,
  md: INPUT_SIZE_METRICS.md.height,
  lg: INPUT_SIZE_METRICS.lg.height,
};

const SIZE_PADDING: Record<InputSize, number> = {
  sm: INPUT_SIZE_METRICS.sm.paddingHorizontal,
  md: INPUT_SIZE_METRICS.md.paddingHorizontal,
  lg: INPUT_SIZE_METRICS.lg.paddingHorizontal,
};

const SIZE_FONT_SIZE: Record<InputSize, number> = {
  sm: INPUT_SIZE_METRICS.sm.fontSize,
  md: INPUT_SIZE_METRICS.md.fontSize,
  lg: INPUT_SIZE_METRICS.lg.fontSize,
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(props, ref) {
  const {
    value,
    defaultValue,
    onChangeText,
    onBlur,
    onEndEditing,
    size = 'md',
    disabled = false,
    error = false,
    label,
    helperText,
    errorText,
    'aria-label': ariaLabel,
    accessibilityLabel,
    placeholder,
    name,
    id: idProp,
    testID,
  } = props;

  const reactId = useId();
  const inputId = idProp ?? `binderly-input-${reactId}`;
  const helperId = `${inputId}-helper`;
  const errorId = `${inputId}-error`;

  const showError = error && errorText;
  const describedBy = showError ? errorId : helperText ? helperId : undefined;

  const handleChange = disabled
    ? undefined
    : (event: ChangeEvt) => {
        onChangeText?.(extractValue(event));
      };

  // Blur / end-editing are reported regardless of `disabled` — they
  // are focus signals, not mutations, so suppressing them would drop
  // a legitimate "user navigated away" event. `onBlur` is surfaced
  // no-arg; `onEndEditing` reads the value off the active platform's
  // event shape (native `nativeEvent.text`, web `target.value`).
  const handleBlur =
    onBlur === undefined && onEndEditing === undefined
      ? undefined
      : (event: ChangeEvt) => {
          onBlur?.();
          onEndEditing?.(extractValue(event));
        };

  return (
    <Container>
      {label !== undefined && label !== null ? (
        <Label htmlFor={inputId} accessibilityRole="text">
          {label}
        </Label>
      ) : null}
      <TamaguiInput
        ref={ref}
        id={inputId}
        name={name}
        value={value}
        defaultValue={defaultValue}
        placeholder={placeholder}
        height={SIZE_HEIGHT[size]}
        paddingHorizontal={SIZE_PADDING[size]}
        style={{ fontSize: SIZE_FONT_SIZE[size] }}
        backgroundColor="$surface"
        borderColor={error ? '$error' : '$border'}
        borderWidth={1}
        borderRadius={8}
        color="$text"
        opacity={disabled ? 0.5 : 1}
        readOnly={disabled || undefined}
        onChange={handleChange as never}
        onBlur={handleBlur as never}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-disabled={disabled || undefined}
        aria-invalid={error || undefined}
        accessibilityLabel={accessibilityLabel ?? ariaLabel}
        accessibilityState={{ disabled }}
        testID={testID}
      />
      {showError ? (
        <ErrorText id={errorId} accessibilityRole="text">
          {errorText}
        </ErrorText>
      ) : helperText ? (
        <HelperText id={helperId} accessibilityRole="text">
          {helperText}
        </HelperText>
      ) : null}
    </Container>
  );
});
