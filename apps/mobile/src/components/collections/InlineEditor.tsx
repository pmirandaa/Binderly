// `<InlineEditor>` — tap-to-edit text helper used by the manual
// detail screen for inline rename + description edit.
//
// Renders the current value as text. Tapping the surface flips into
// an `<Input>` + Save / Cancel pair. Save fires the `onSave`
// callback with the trimmed value; the parent owns the mutation +
// success / failure feedback.
//
// Stays purely presentational — no remote state lives here so tests
// can fire the press / change / press sequence without mocking
// TanStack Query.

import { useEffect, useState, type ReactNode } from 'react';

import { Button, Input, Pressable, Text, XStack, YStack } from '@binderly/ui';

export interface InlineEditorProps {
  readonly label: string;
  readonly value: string;
  readonly placeholder?: string;
  readonly multiline?: boolean;
  readonly onSave: (next: string) => void;
  readonly disabled?: boolean;
  readonly testID?: string;
}

export function InlineEditor(props: InlineEditorProps): ReactNode {
  const { label, value, placeholder, onSave, disabled = false } = props;
  const testID = props.testID ?? 'inline-editor';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  // Keep the draft synced when the parent updates `value` (e.g. after
  // an external mutation invalidates the cache).
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  if (editing) {
    return (
      <YStack gap="$2" testID={`${testID}-editing`}>
        <Input
          aria-label={label}
          accessibilityLabel={label}
          value={draft}
          onChangeText={setDraft}
          {...(placeholder !== undefined ? { placeholder } : {})}
          testID={`${testID}-input`}
        />
        <XStack gap="$2">
          <Button
            label="Save"
            variant="primary"
            size="sm"
            onPress={() => {
              const next = draft.trim();
              setEditing(false);
              if (next.length > 0 && next !== value) onSave(next);
            }}
            accessibilityLabel={`Save ${label}`}
            testID={`${testID}-save`}
          />
          <Button
            label="Cancel"
            variant="ghost"
            size="sm"
            onPress={() => {
              setDraft(value);
              setEditing(false);
            }}
            accessibilityLabel={`Cancel ${label}`}
            testID={`${testID}-cancel`}
          />
        </XStack>
      </YStack>
    );
  }

  const displayValue = value.length > 0 ? value : (placeholder ?? '—');
  return (
    <Pressable
      onPress={() => {
        if (!disabled) setEditing(true);
      }}
      variant="ghost"
      paddingVertical="$2"
      paddingHorizontal="$2"
      borderRadius={6}
      aria-label={`Edit ${label}`}
      accessibilityLabel={`Edit ${label}`}
      testID={`${testID}-display`}
      disabled={disabled}
    >
      <Text
        variant={props.multiline === true ? 'body' : 'subtitle'}
        tone={value.length > 0 ? 'default' : 'muted'}
      >
        {displayValue}
      </Text>
    </Pressable>
  );
}
