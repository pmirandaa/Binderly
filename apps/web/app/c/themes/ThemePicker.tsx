'use client';

// Pro-gated theme gallery for the owner settings surface.
//
// Replaces the old `'default'`-only `<select>` placeholder. Every
// theme renders as a clickable thumbnail so a free user can *preview*
// the whole gallery — but the `shareable_themes` gate (T-PB-GATING's
// `useGate`) decides whether a Pro theme can actually be applied:
//   - Pro / unlocked → selecting any theme calls `onSelect`.
//   - Free / locked  → selecting a Pro theme is a no-op for
//     persistence and surfaces the shared `<UpgradePrompt>` instead;
//     the free `default` stays selectable.
//
// Gating path: this consumes the merged `useGate('shareable_themes')`
// hook from `@/lib/gating` (T-PB-GATING, iter 34) — not the
// entitlements fallback.

import { useState } from 'react';

import { type ShareableTheme } from '@binderly/api-contracts';
import { Text, XStack, YStack } from '@binderly/ui';

import { THEME_LIST, type Theme } from './registry';
import { ThemeThumbnail } from './ThemeThumbnail';
import { UpgradePrompt, useGate } from '../../../lib/gating';

import type { ReactNode } from 'react';

export interface ThemePickerProps {
  /** The currently-selected theme id. */
  readonly value: ShareableTheme;
  /** Called when a selectable theme is picked. Pro themes only fire when unlocked. */
  readonly onSelect: (theme: ShareableTheme) => void;
  /** Testid prefix for the picker + its options. */
  readonly testId?: string;
}

export function ThemePicker({
  value,
  onSelect,
  testId = 'theme-picker',
}: ThemePickerProps): ReactNode {
  const { result } = useGate('shareable_themes');
  const unlocked = result.allowed;
  const [blockedAttempt, setBlockedAttempt] = useState(false);

  function handlePick(theme: Theme): void {
    if (theme.pro && !unlocked) {
      setBlockedAttempt(true);
      return;
    }
    setBlockedAttempt(false);
    onSelect(theme.id);
  }

  return (
    <YStack gap="$3" data-testid={testId}>
      <Text variant="caption">Theme</Text>

      <XStack gap="$3" flexWrap="wrap" data-testid={`${testId}-gallery`}>
        {THEME_LIST.map((theme) => {
          const selected = theme.id === value;
          const locked = theme.pro && !unlocked;
          return (
            <button
              key={theme.id}
              type="button"
              onClick={() => handlePick(theme)}
              data-testid={`${testId}-option-${theme.id}`}
              data-selected={selected ? 'true' : 'false'}
              data-locked={locked ? 'true' : 'false'}
              aria-pressed={selected}
              aria-label={`${theme.name}${theme.pro ? ' (Pro)' : ''}`}
              style={{
                background: 'transparent',
                border: 'none',
                padding: 0,
                margin: 0,
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 4,
              }}
            >
              <ThemeThumbnail theme={theme} selected={selected} />
              <Text variant="bodySmall" tone={locked ? 'muted' : undefined}>
                {theme.name}
                {theme.pro ? ' · Pro' : ''}
              </Text>
            </button>
          );
        })}
      </XStack>

      {!unlocked ? (
        <Text variant="bodySmall" tone="muted" data-testid={`${testId}-free-hint`}>
          Themes are a Pro feature. Preview any theme here — upgrade to apply it to your public page.
        </Text>
      ) : null}

      {blockedAttempt && !unlocked ? (
        <UpgradePrompt
          feature="shareable_themes"
          reason="requires_pro"
          testId={`${testId}-upgrade`}
        />
      ) : null}
    </YStack>
  );
}
