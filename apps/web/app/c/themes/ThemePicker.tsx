'use client';

// `<ThemePicker>` — the Pro-gated theme gallery the shareable settings
// row editor renders. T-SH-THEMES.
//
// Renders one selectable swatch per theme as an ARIA radio-group. Free
// users may preview every theme but only `default` is selectable; a tap
// on a locked (non-default) theme surfaces the upgrade prompt and does
// NOT change the draft selection (no non-default persist on free).
//
// ── Gating ──────────────────────────────────────────────────────────
// The verdict comes from `@binderly/feature-flags`' pure
// `evaluateGate(...)` decision core — the same core the `useGate` hook
// wraps — fed by the owner's already-fetched subscription `tier`. The
// settings surface holds the authoritative tier, so we gate on it
// directly rather than firing a second `/v1/me/entitlements` read deep
// in a nested editor. Fail-closed: an absent / free tier locks every
// non-default theme. The public render path enforces the same gate
// server-side via `resolvePublicTheme`.

import { useState } from 'react';

import type { ShareableTheme } from '@binderly/api-contracts';
import type { Tier } from '@binderly/entitlements';
import { evaluateGate } from '@binderly/feature-flags';
import { Text, XStack, YStack } from '@binderly/ui';

import { THEME_LIST } from './registry';
import { ThemeSwatch } from './ThemeSwatch';
import { UpgradePrompt } from '../../../lib/gating/Gate';

import type { ReactNode } from 'react';

export interface ThemePickerProps {
  readonly value: ShareableTheme;
  readonly onChange: (next: ShareableTheme) => void;
  /** Owner's tier — gates non-default theme selection. */
  readonly tier?: Tier;
  /** Disable interaction (e.g. while a save is in flight). */
  readonly disabled?: boolean;
}

export function ThemePicker({
  value,
  onChange,
  tier = 'free',
  disabled = false,
}: ThemePickerProps): ReactNode {
  const allowed = evaluateGate({ tier }, 'shareable_themes').allowed;
  const [showPrompt, setShowPrompt] = useState(false);

  function handlePick(themeId: ShareableTheme, locked: boolean): void {
    if (disabled) return;
    if (locked) {
      setShowPrompt(true);
      return;
    }
    setShowPrompt(false);
    onChange(themeId);
  }

  return (
    <YStack gap="$2" data-testid="theme-picker-block">
      <Text variant="caption" tone="muted">
        Theme{allowed ? '' : ' · Pro unlocks more'}
      </Text>
      <XStack
        gap="$3"
        flexWrap="wrap"
        role="radiogroup"
        aria-label="Shareable theme"
        data-testid="theme-picker"
      >
        {THEME_LIST.map((theme) => {
          const locked = theme.id !== 'default' && !allowed;
          const selected = theme.id === value;
          return (
            <button
              key={theme.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${theme.label} theme${locked ? ' (Pro)' : ''}`}
              data-testid={`theme-picker-option-${theme.id}`}
              data-locked={locked ? 'true' : 'false'}
              disabled={disabled}
              onClick={() => handlePick(theme.id, locked)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                padding: 8,
                borderRadius: 12,
                cursor: disabled ? 'default' : 'pointer',
                background: 'transparent',
                border: selected
                  ? `2px solid ${theme.accent}`
                  : '2px solid transparent',
                opacity: locked ? 0.55 : 1,
              }}
            >
              <ThemeSwatch theme={theme} />
              <Text variant="bodySmall" tone={locked ? 'muted' : undefined}>
                {theme.label}
                {locked ? ' · Pro' : ''}
              </Text>
            </button>
          );
        })}
      </XStack>
      {showPrompt && !allowed ? (
        <UpgradePrompt
          feature="shareable_themes"
          reason="requires_pro"
          testId="theme-upgrade-prompt"
          ctaLabel="Unlock themes with Pro"
        />
      ) : null}
    </YStack>
  );
}
