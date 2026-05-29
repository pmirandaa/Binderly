import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BinderlyClient } from '@binderly/api-client';
import type {
  EntitlementsDto,
  SubmitCommunitySubmissionRequest,
  SubmitCommunitySubmissionResponse,
} from '@binderly/api-contracts';

import { ApiClientProvider } from '../../../lib/api-client';
import { renderWithProvider } from '../../../test-utils/render';
import { CommunitySubmissionScreen } from '../screens/CommunitySubmissionScreen';

const { routerMocks } = vi.hoisted(() => ({
  routerMocks: {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    canGoBack: vi.fn(() => true),
  },
}));

vi.mock('expo-router', () => ({
  router: routerMocks,
  useRouter: () => routerMocks,
  useLocalSearchParams: () => ({}),
  usePathname: () => '/',
  useSegments: () => [],
}));

beforeEach(() => {
  routerMocks.push.mockClear();
  routerMocks.back.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

const IMAGES = {
  front: 'https://cdn.binderly.test/u/1/front.jpg',
  back: 'https://cdn.binderly.test/u/1/back.jpg',
  corners: ['https://cdn.binderly.test/u/1/c1.jpg'],
};

function entitlements(tier: 'free' | 'pro'): EntitlementsDto {
  return {
    tier,
    activeFeatures: tier === 'pro' ? ['grading_prediction'] : [],
    source: 'revenuecat',
    checkedAt: '2026-05-29T12:00:00Z',
  };
}

function submitResponse(alreadySubmitted = false): SubmitCommunitySubmissionResponse {
  return {
    alreadySubmitted,
    submission: {
      id: 'cccccccc-3333-4333-8333-cccccccccccc',
      userId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
      gradingSubmissionId: null,
      gradeCompany: 'PSA',
      certNumber: '12345678',
      certNumberNormalized: '12345678',
      overallGrade: 9,
      subgrades: null,
      blackLabel: false,
      rawGradeLabel: null,
      images: IMAGES,
      consent: true,
      status: 'pending',
      ingestedSourceId: null,
      createdAt: '2026-05-29T12:00:00Z',
      updatedAt: '2026-05-29T12:00:00Z',
    },
  };
}

interface ClientOverrides {
  readonly tier?: 'free' | 'pro';
  readonly getMyEntitlements?: ReturnType<typeof vi.fn>;
  readonly submit?: ReturnType<typeof vi.fn>;
}

function buildClient(opts: ClientOverrides = {}) {
  return {
    entitlements: {
      getMyEntitlements:
        opts.getMyEntitlements ?? vi.fn(async () => entitlements(opts.tier ?? 'pro')),
    },
    communitySubmissions: {
      submitCommunitySubmission: opts.submit ?? vi.fn(async () => submitResponse(false)),
    },
  };
}

function renderScreen(
  opts: ClientOverrides & { capturedImages?: typeof IMAGES } = {},
): ReturnType<typeof buildClient> {
  const client = buildClient(opts);
  renderWithProvider(
    <ApiClientProvider client={client as unknown as BinderlyClient}>
      <CommunitySubmissionScreen capturedImages={opts.capturedImages ?? IMAGES} />
    </ApiClientProvider>,
  );
  return client;
}

async function fillField(testId: string, value: string): Promise<void> {
  await act(async () => {
    fireEvent.change(screen.getByTestId(testId), { target: { value } });
  });
}

describe('<CommunitySubmissionScreen> gating', () => {
  it('shows the upgrade prompt for a free user', async () => {
    renderScreen({ tier: 'free' });
    await waitFor(() => {
      expect(screen.queryByTestId('m-community-upgrade')).not.toBeNull();
    });
    expect(screen.queryByTestId('m-community-cert')).toBeNull();
  });

  it('routes to the paywall when upgrade is tapped', async () => {
    renderScreen({ tier: 'free' });
    await waitFor(() => {
      expect(screen.queryByTestId('m-community-upgrade-button')).not.toBeNull();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('m-community-upgrade-button'));
    });
    expect(routerMocks.push).toHaveBeenCalledWith('/paywall');
  });

  it('renders the form for a pro user', async () => {
    renderScreen({ tier: 'pro' });
    await waitFor(() => {
      expect(screen.queryByTestId('m-community-cert')).not.toBeNull();
    });
    expect(screen.queryByTestId('m-community-consent-note')).not.toBeNull();
  });

  it('falls back to the upgrade prompt when the entitlements read fails', async () => {
    renderScreen({
      getMyEntitlements: vi.fn(async () => {
        throw new Error('rc down');
      }),
    });
    await waitFor(() => {
      expect(screen.queryByTestId('m-community-upgrade')).not.toBeNull();
    });
  });
});

describe('<CommunitySubmissionScreen> submission', () => {
  async function setupProForm(opts: ClientOverrides = {}) {
    const client = renderScreen({ ...opts, tier: opts.tier ?? 'pro' });
    await waitFor(() => {
      expect(screen.queryByTestId('m-community-cert')).not.toBeNull();
    });
    return client;
  }

  it('submits a valid form and shows success', async () => {
    const client = await setupProForm();
    await fillField('m-community-cert', '12345678');
    await fillField('m-community-overall', '9');
    await act(async () => {
      fireEvent.click(screen.getByTestId('m-community-consent'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('m-community-submit'));
    });
    await waitFor(() => {
      expect(screen.queryByTestId('m-community-success')).not.toBeNull();
    });
    expect(client.communitySubmissions.submitCommunitySubmission).toHaveBeenCalledTimes(1);
    const arg = client.communitySubmissions.submitCommunitySubmission.mock.calls[0]?.[0] as
      | SubmitCommunitySubmissionRequest
      | undefined;
    expect(arg?.certNumber).toBe('12345678');
    expect(arg?.overallGrade).toBe(9);
  });

  it('shows the already-submitted state on an idempotent re-submit', async () => {
    await setupProForm({ submit: vi.fn(async () => submitResponse(true)) });
    await fillField('m-community-cert', '12345678');
    await fillField('m-community-overall', '9');
    await act(async () => {
      fireEvent.click(screen.getByTestId('m-community-consent'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('m-community-submit'));
    });
    await waitFor(() => {
      expect(screen.queryByTestId('m-community-already')).not.toBeNull();
    });
  });

  it('shows an error banner when submit fails', async () => {
    await setupProForm({
      submit: vi.fn(async () => {
        throw Object.assign(new Error('nope'), { code: 'FORBIDDEN' });
      }),
    });
    await fillField('m-community-cert', '12345678');
    await fillField('m-community-overall', '9');
    await act(async () => {
      fireEvent.click(screen.getByTestId('m-community-consent'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('m-community-submit'));
    });
    await waitFor(() => {
      expect(screen.queryByTestId('m-community-submit-error')).not.toBeNull();
    });
  });

  it('blocks submit and shows a cert error on invalid input', async () => {
    const client = await setupProForm();
    await fillField('m-community-cert', 'ABC');
    await fillField('m-community-overall', '9');
    await act(async () => {
      fireEvent.click(screen.getByTestId('m-community-consent'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('m-community-submit'));
    });
    expect(client.communitySubmissions.submitCommunitySubmission).not.toHaveBeenCalled();
  });

  it('blocks submit without consent', async () => {
    const client = await setupProForm();
    await fillField('m-community-cert', '12345678');
    await fillField('m-community-overall', '9');
    await act(async () => {
      fireEvent.click(screen.getByTestId('m-community-submit'));
    });
    expect(client.communitySubmissions.submitCommunitySubmission).not.toHaveBeenCalled();
    expect(screen.queryByTestId('m-community-error-consent')).not.toBeNull();
  });

  it('submits with the selected grading company', async () => {
    const client = await setupProForm();
    await act(async () => {
      fireEvent.click(screen.getByTestId('m-community-company-BGS'));
    });
    await fillField('m-community-cert', '0015384312');
    await fillField('m-community-overall', '9.5');
    await act(async () => {
      fireEvent.click(screen.getByTestId('m-community-consent'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('m-community-submit'));
    });
    await waitFor(() => {
      expect(client.communitySubmissions.submitCommunitySubmission).toHaveBeenCalledTimes(1);
    });
    const arg = client.communitySubmissions.submitCommunitySubmission.mock.calls[0]?.[0] as
      | SubmitCommunitySubmissionRequest
      | undefined;
    expect(arg?.gradeCompany).toBe('BGS');
    expect(arg?.overallGrade).toBe(9.5);
  });
});

describe('<CommunitySubmissionScreen> capture notice', () => {
  it('shows a capture-needed notice when photos are missing', async () => {
    const client = buildClient({ tier: 'pro' });
    renderWithProvider(
      <ApiClientProvider client={client as unknown as BinderlyClient}>
        <CommunitySubmissionScreen />
      </ApiClientProvider>,
    );
    await waitFor(() => {
      expect(screen.queryByTestId('m-community-capture-needed')).not.toBeNull();
    });
  });
});
