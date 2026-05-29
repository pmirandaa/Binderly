// `<DisambigPicker>` — bottom-sheet candidate list shown when the
// matcher emits `disposition === 'disambiguate'`.
//
// Presents up to 3 candidate printings. The user taps one to
// confirm the add (same path as auto-add). The picker is dismissed
// by the parent once the user confirms or cancels.
//
// The component is pure: all data comes as props; the parent owns
// the API call.

import { type ReactNode } from 'react';

import { Button, Text, XStack, YStack } from '@binderly/ui';

import { CardThumbnail } from './CardThumbnail.js';

import type { AnnSearchResult } from '../ann/types.js';

export interface DisambigCandidate {
  /** catalog printing.id */
  readonly printingId: string;
  /** Cosine similarity in [-1, 1]. */
  readonly score: number;
  /** Friendly name — populated from catalog lookup, falls back to id. */
  readonly displayName: string;
  /** Set name — may be empty until catalog lookup resolves. */
  readonly setName: string;
  /** Collector number — may be empty. */
  readonly collectorNumber: string;
  /**
   * Thumbnail URL from the catalog lookup (FU-34). `null` / undefined
   * while loading or when the printing has no image — the row shows a
   * placeholder box.
   */
  readonly thumbnailUrl?: string | null;
}

/** Shape the catalog name/thumbnail lookup returns per printing id. */
export interface DisambigLookupResult {
  readonly displayName: string;
  readonly setName: string;
  readonly collectorNumber: string;
  readonly thumbnailUrl?: string | null;
}

export interface DisambigPickerProps {
  /** Top-3 candidates from the `MatchResult.candidates` array. */
  readonly candidates: readonly DisambigCandidate[];
  /** Called when the user taps a candidate. */
  onConfirm(printingId: string): void;
  /** Called when the user dismisses without selecting. */
  onDismiss(): void;
  readonly testID?: string;
}

/** Build `DisambigCandidate` list from raw ANN results (name lookup TBD). */
export function buildDisambigCandidates(
  annResults: readonly AnnSearchResult[],
  nameLookup: (printingId: string) => DisambigLookupResult = (id) => ({
    displayName: id,
    setName: '',
    collectorNumber: '',
    thumbnailUrl: null,
  }),
): DisambigCandidate[] {
  return annResults.slice(0, 3).map((r) => ({
    printingId: r.printingId,
    score: r.score,
    ...nameLookup(r.printingId),
  }));
}

export function DisambigPicker(props: DisambigPickerProps): ReactNode {
  const { candidates, onConfirm, onDismiss, testID } = props;

  return (
    <YStack
      backgroundColor="$background"
      borderTopLeftRadius="$4"
      borderTopRightRadius="$4"
      padding="$4"
      gap="$3"
      testID={testID ?? 'disambig-picker'}
      accessibilityLabel="Choose the matching card"
      accessible
    >
      <XStack justifyContent="space-between" alignItems="center">
        <Text variant="subtitle" tone="default">
          Which card is this?
        </Text>
        <Button
          variant="ghost"
          onPress={onDismiss}
          testID="disambig-dismiss"
          accessibilityLabel="Dismiss card chooser"
          accessibilityRole="button"
        >
          Cancel
        </Button>
      </XStack>

      <YStack gap="$2">
        {candidates.map((c, i) => (
          <DisambigCandidateRow
            key={c.printingId}
            candidate={c}
            index={i}
            onConfirm={onConfirm}
          />
        ))}
      </YStack>

      {candidates.length === 0 && (
        <Text
          variant="body"
          tone="muted"
          testID="disambig-no-candidates"
        >
          No candidates found. Try rescanning.
        </Text>
      )}
    </YStack>
  );
}

interface DisambigCandidateRowProps {
  readonly candidate: DisambigCandidate;
  readonly index: number;
  onConfirm(printingId: string): void;
}

function DisambigCandidateRow({
  candidate,
  index,
  onConfirm,
}: DisambigCandidateRowProps): ReactNode {
  const pct = Math.round(candidate.score * 100);

  return (
    <Button
      variant="secondary"
      onPress={() => onConfirm(candidate.printingId)}
      testID={`disambig-candidate-${index}`}
      accessibilityLabel={`Select ${candidate.displayName}`}
      accessibilityRole="button"
    >
      <XStack flex={1} gap="$2" justifyContent="space-between" alignItems="center">
        <CardThumbnail
          url={candidate.thumbnailUrl}
          label={candidate.collectorNumber || candidate.displayName || candidate.printingId}
          testID={`disambig-candidate-${index}-thumbnail`}
        />
        <YStack flex={1} gap="$1" alignItems="flex-start">
          <Text variant="body" tone="default">
            {candidate.displayName || candidate.printingId}
          </Text>
          {(candidate.setName.length > 0 || candidate.collectorNumber.length > 0) && (
            <Text variant="caption" tone="muted">
              {candidate.setName}
              {candidate.setName && candidate.collectorNumber ? ' · ' : ''}
              {candidate.collectorNumber}
            </Text>
          )}
        </YStack>
        <Text variant="caption" tone="muted">
          {pct}%
        </Text>
      </XStack>
    </Button>
  );
}
