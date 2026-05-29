// `<CommunitySubmissionScreen>` — the pro-gated community-flywheel submission UI.
//
// A pro user submits the real graded outcome of one of their cards (slab cert +
// the photos captured during the multi-shot capture flow) so it becomes
// labelled training data (PROJECT.md § 12). Per § 16 this is a Pro feature, so
// the entry point is pro-gated: free users see an upgrade prompt instead of the
// form.
//
// ## Gating path (documented decision)
//
// T-PB-GATING (the `@binderly/feature-flags` + mobile `useGate` hook) had NOT
// merged when this shipped, so we use the `@binderly/entitlements` fallback the
// task brief blesses: read `client.entitlements.getMyEntitlements()` and gate on
// `activeFeatures.includes('grading_prediction')` (equivalent to
// `canUseFeature(tier, 'grading_prediction')`). Swap this single call site for
// `useGate('grading_prediction')` at the T-PB-GATING merge.
//
// The server also enforces the gate (free → 403); this is the optimistic
// up-front gate so the user never fills the form only to be rejected.

import { useRouter } from 'expo-router';
import { useEffect, useReducer, useState, type ReactNode } from 'react';

import { Button, Card, Input, Spinner, Text, XStack, YStack } from '@binderly/ui';

import { useApiClient } from '../../../lib/api-client.js';
import {
  canSubmit,
  initialSubmissionState,
  reduceSubmission,
} from '../submission-machine.js';
import {
  COMMUNITY_GRADE_COMPANIES,
  SUBGRADE_KEYS,
  emptyCommunityForm,
  type CommunityGradeCompany,
  type CommunitySubmissionForm,
  type CommunitySubmissionImages,
  type SubgradeKey,
} from '../types.js';
import { validateCommunityForm } from '../validation.js';

const GRADING_FEATURE = 'grading_prediction' as const;

type GateState = 'loading' | 'free' | 'pro' | 'gate_error';

export interface CommunitySubmissionScreenProps {
  /**
   * The photo references from the just-completed capture session. When absent
   * the form renders a "capture photos first" notice and validation blocks
   * submit (the models need at least front + back).
   */
  readonly capturedImages?: CommunitySubmissionImages;
  /** Optional link to the capture session that produced the photos. */
  readonly gradingSubmissionId?: string;
  /** Route the upgrade CTA pushes to. Defaults to `/paywall`. */
  readonly upgradeRoute?: string;
  readonly testID?: string;
}

export function CommunitySubmissionScreen(
  props: CommunitySubmissionScreenProps,
): ReactNode {
  const client = useApiClient();
  const router = useRouter();
  const images = props.capturedImages ?? {};

  const [gate, setGate] = useState<GateState>('loading');
  const [form, setForm] = useState<CommunitySubmissionForm>(emptyCommunityForm);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [submission, dispatch] = useReducer(reduceSubmission, initialSubmissionState);

  // ── pro-gate (entitlements fallback) ─────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const ent = await client.entitlements.getMyEntitlements();
        if (cancelled) return;
        const isPro =
          ent.tier === 'pro' || ent.activeFeatures.includes(GRADING_FEATURE);
        setGate(isPro ? 'pro' : 'free');
      } catch {
        if (!cancelled) setGate('gate_error');
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, [client]);

  const setField = <K extends keyof CommunitySubmissionForm>(
    key: K,
    value: CommunitySubmissionForm[K],
  ): void => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const setSubgrade = (key: SubgradeKey, value: string): void => {
    setForm((prev) => ({ ...prev, subgrades: { ...prev.subgrades, [key]: value } }));
  };

  const handleSubmit = (): void => {
    if (!canSubmit(submission)) return;
    const outcome = validateCommunityForm(form, images);
    setErrors(outcome.errors);
    if (!outcome.ok || outcome.request === undefined) return;

    const request = outcome.request;
    dispatch({ type: 'submit' });
    void (async (): Promise<void> => {
      try {
        const response = await client.communitySubmissions.submitCommunitySubmission(
          props.gradingSubmissionId !== undefined
            ? { ...request, gradingSubmissionId: props.gradingSubmissionId }
            : request,
        );
        dispatch({ type: 'resolve', response });
      } catch (cause) {
        dispatch({ type: 'fail', message: describeSubmitError(cause) });
      }
    })();
  };

  // ── gate: loading / free / error ──────────────────────────────────────────
  if (gate === 'loading') {
    return (
      <YStack testID={props.testID ?? 'm-community'} padding={16} gap={12}>
        <YStack testID="m-community-loading" alignItems="center" padding={24}>
          <Spinner aria-label="Checking your subscription" />
        </YStack>
      </YStack>
    );
  }

  if (gate === 'free' || gate === 'gate_error') {
    return (
      <YStack testID={props.testID ?? 'm-community'} padding={16} gap={12}>
        <YStack testID="m-community-upgrade" gap={8}>
          <Text variant="title">Help improve grading</Text>
          <Text tone="muted">
            Submitting your graded cards as training data is a Pro feature. Upgrade
            to contribute your slab outcomes and help the models get better.
          </Text>
          <Button
            testID="m-community-upgrade-button"
            label="Upgrade to Pro"
            onPress={() => router.push(props.upgradeRoute ?? '/paywall')}
          />
        </YStack>
      </YStack>
    );
  }

  // ── success / already-submitted terminal panels ───────────────────────────
  if (submission.status === 'success') {
    return (
      <YStack testID={props.testID ?? 'm-community'} padding={16} gap={12}>
        <YStack testID="m-community-success" gap={8}>
          <Text variant="title">Thank you!</Text>
          <Text tone="muted">
            Your graded outcome was submitted. It will help train the grading
            models.
          </Text>
          <Button
            testID="m-community-success-done"
            label="Done"
            onPress={() => {
              if (router.canGoBack()) router.back();
            }}
          />
        </YStack>
      </YStack>
    );
  }

  if (submission.status === 'already_submitted') {
    return (
      <YStack testID={props.testID ?? 'm-community'} padding={16} gap={12}>
        <YStack testID="m-community-already" gap={8}>
          <Text variant="title">Already submitted</Text>
          <Text tone="muted">
            You&apos;ve already submitted this cert number. Thanks for
            contributing!
          </Text>
          <Button
            testID="m-community-already-done"
            label="Done"
            onPress={() => {
              if (router.canGoBack()) router.back();
            }}
          />
        </YStack>
      </YStack>
    );
  }

  // ── pro: the form ──────────────────────────────────────────────────────────
  const submitting = submission.status === 'submitting';

  return (
    <YStack testID={props.testID ?? 'm-community'} padding={16} gap={12}>
      <Text variant="title">Submit a graded card</Text>

      {props.capturedImages === undefined || !images.front || !images.back ? (
        <Card testID="m-community-capture-needed" padding={12}>
          <Text tone="muted">
            Capture the front and back of your card first, then submit its grade.
          </Text>
        </Card>
      ) : null}

      {/* company selector */}
      <YStack gap={6}>
        <Text variant="label">Grading company</Text>
        <XStack gap={8} testID="m-community-company">
          {COMMUNITY_GRADE_COMPANIES.map((company: CommunityGradeCompany) => (
            <Button
              key={company}
              testID={`m-community-company-${company}`}
              label={company}
              size="sm"
              variant={form.gradeCompany === company ? 'primary' : 'secondary'}
              onPress={() => setField('gradeCompany', company)}
            />
          ))}
        </XStack>
      </YStack>

      <Input
        testID="m-community-cert"
        label="Cert number"
        placeholder="e.g. 12345678"
        value={form.certNumber}
        onChangeText={(next) => setField('certNumber', next)}
        error={errors.certNumber !== undefined}
        errorText={errors.certNumber}
      />

      <Input
        testID="m-community-overall"
        label="Overall grade"
        placeholder="e.g. 9 or 9.5"
        value={form.overallGrade}
        onChangeText={(next) => setField('overallGrade', next)}
        error={errors.overallGrade !== undefined}
        errorText={errors.overallGrade}
      />

      {/* optional sub-grades */}
      <YStack gap={6} testID="m-community-subgrades">
        <Text variant="label">Sub-grades (optional)</Text>
        <XStack gap={8} flexWrap="wrap">
          {SUBGRADE_KEYS.map((key: SubgradeKey) => (
            <Input
              key={key}
              testID={`m-community-sub-${key}`}
              size="sm"
              placeholder={key}
              value={form.subgrades[key]}
              onChangeText={(next) => setSubgrade(key, next)}
              error={errors[`subgrade_${key}`] !== undefined}
              errorText={errors[`subgrade_${key}`]}
            />
          ))}
        </XStack>
      </YStack>

      <Button
        testID="m-community-blacklabel"
        size="sm"
        variant={form.blackLabel ? 'primary' : 'secondary'}
        label={form.blackLabel ? 'Black Label ✓' : 'BGS Black Label?'}
        onPress={() => setField('blackLabel', !form.blackLabel)}
      />

      {/* consent */}
      <Card testID="m-community-consent-note" padding={12}>
        <Text tone="muted">
          By submitting, your card photos and the slab grade become training data
          used to improve Binderly&apos;s grading models. You can request removal
          any time.
        </Text>
      </Card>
      <Button
        testID="m-community-consent"
        size="sm"
        variant={form.consent ? 'primary' : 'secondary'}
        label={form.consent ? 'I consent ✓' : 'I consent to this'}
        onPress={() => setField('consent', !form.consent)}
      />
      {errors.consent !== undefined ? (
        <Text testID="m-community-error-consent" tone="error">
          {errors.consent}
        </Text>
      ) : null}
      {errors.images !== undefined ? (
        <Text testID="m-community-error-images" tone="error">
          {errors.images}
        </Text>
      ) : null}

      {submission.status === 'error' ? (
        <Text testID="m-community-submit-error" tone="error">
          {submission.message}
        </Text>
      ) : null}

      <Button
        testID="m-community-submit"
        label="Submit graded card"
        loading={submitting}
        disabled={submitting}
        onPress={handleSubmit}
      />
    </YStack>
  );
}

/** Map a thrown submit error to a short, user-facing message. */
export function describeSubmitError(cause: unknown): string {
  if (cause !== null && typeof cause === 'object') {
    const code = (cause as { code?: unknown }).code;
    if (code === 'FORBIDDEN') {
      return 'Submitting graded cards is a Pro feature.';
    }
    const message = (cause as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) {
      return message;
    }
  }
  return 'Something went wrong submitting your card. Please try again.';
}
