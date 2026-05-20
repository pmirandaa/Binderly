import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../../test-utils/render';
import { createFakeSettingsApi, FAKE_SHAREABLE } from './fixtures';
import { ShareablesSettingsView } from './ShareablesSettingsView';

describe('ShareablesSettingsView', () => {
  it('renders the page shell after loading the profile + shareables', async () => {
    const api = createFakeSettingsApi();
    renderWithProviders(<ShareablesSettingsView api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('settings-shareables-page')).toBeInTheDocument();
    });
    expect(screen.getByTestId('profile-fields-card')).toBeInTheDocument();
    expect(screen.getByTestId('settings-shareables-list')).toBeInTheDocument();
    expect(screen.getByTestId('settings-shareables-create-card')).toBeInTheDocument();
  });

  it('renders the empty state when the user has no shareables', async () => {
    const api = createFakeSettingsApi({ shareables: [] });
    renderWithProviders(<ShareablesSettingsView api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('settings-shareables-empty')).toBeInTheDocument();
    });
  });

  it('shows the free-tier cap badge when the user is at the cap', async () => {
    const api = createFakeSettingsApi();
    renderWithProviders(<ShareablesSettingsView api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('settings-shareables-cap-badge')).toBeInTheDocument();
    });
  });

  it('does NOT show the cap badge for pro users with the same number of shareables', async () => {
    const api = createFakeSettingsApi({
      subscription: {
        userId: '11111111-2222-4222-8222-111111111111',
        tier: 'pro',
        source: 'paddle',
        externalCustomerId: 'pdl_1',
        expiresAt: '2027-05-20T00:00:00Z',
        lastEventAt: '2026-05-20T00:00:00Z',
      },
    });
    renderWithProviders(<ShareablesSettingsView api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('settings-shareables-page')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('settings-shareables-cap-badge')).toBeNull();
  });

  it('disables the create button while at the free-tier cap', async () => {
    const api = createFakeSettingsApi();
    renderWithProviders(<ShareablesSettingsView api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('settings-shareables-create-button')).toBeInTheDocument();
    });
    const btn = screen.getByTestId('settings-shareables-create-button');
    expect(btn.getAttribute('aria-disabled')).toBe('true');
  });

  it('appends a newly-created shareable to the list', async () => {
    const api = createFakeSettingsApi({ shareables: [] });
    renderWithProviders(<ShareablesSettingsView api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('settings-shareables-create-slug')).toBeInTheDocument();
    });
    const input = screen.getByTestId('settings-shareables-create-slug') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: 'new-binder' } });
    });
    const btn = screen.getByTestId('settings-shareables-create-button');
    await act(async () => {
      fireEvent.click(btn);
    });
    await waitFor(() => {
      expect(screen.getByTestId('settings-shareables-list')).toBeInTheDocument();
    });
    expect(api.state.shareables.length).toBe(1);
    expect(api.state.shareables[0]?.slug).toBe('new-binder');
  });

  it('shows the error state when the initial fetch fails', async () => {
    const api = createFakeSettingsApi();
    // Replace getMyProfile with a failing impl.
    (api as unknown as { getMyProfile: () => Promise<never> }).getMyProfile = () => {
      return Promise.reject(new Error('boom'));
    };
    renderWithProviders(<ShareablesSettingsView api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('settings-shareables-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('settings-shareables-error').textContent).toContain('boom');
  });

  it('optimistically updates the profile then commits the server response', async () => {
    const api = createFakeSettingsApi();
    renderWithProviders(<ShareablesSettingsView api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('profile-fields-card')).toBeInTheDocument();
    });
    const handleInput = screen.getByTestId('profile-handle-input') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(handleInput, { target: { value: 'pablo-2' } });
    });
    // Wait for debounce to settle to 'available'.
    await waitFor(() => {
      expect(screen.getByTestId('profile-handle-availability').textContent).toContain('available');
    });
    const saveBtn = screen.getByTestId('profile-fields-save');
    await act(async () => {
      fireEvent.click(saveBtn);
    });
    await waitFor(() => {
      expect(api.state.profile.handle).toBe('pablo-2');
    });
  });

  it('rolls back the profile on a save error', async () => {
    const api = createFakeSettingsApi();
    api.setProfileError(new Error('server says no'));
    renderWithProviders(<ShareablesSettingsView api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('profile-fields-card')).toBeInTheDocument();
    });
    const handleInput = screen.getByTestId('profile-handle-input') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(handleInput, { target: { value: 'pablo-3' } });
    });
    await waitFor(() => {
      expect(screen.getByTestId('profile-handle-availability').textContent).toContain('available');
    });
    const saveBtn = screen.getByTestId('profile-fields-save');
    await act(async () => {
      fireEvent.click(saveBtn);
    });
    await waitFor(() => {
      expect(screen.getByTestId('profile-fields-error')).toBeInTheDocument();
    });
    expect(api.state.profile.handle).toBe('pablo');
  });

  it('renders the per-shareable row editor with the public URL preview', async () => {
    const api = createFakeSettingsApi();
    renderWithProviders(<ShareablesSettingsView api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId(`shareable-row-${FAKE_SHAREABLE.id}`)).toBeInTheDocument();
    });
    expect(screen.getByTestId('shareable-row-url').textContent).toBe('binderly.app/c/pablo/my-binder');
  });

  it('persists a toggle change to the server and updates state on success', async () => {
    const api = createFakeSettingsApi();
    renderWithProviders(<ShareablesSettingsView api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('shareable-row-show-missing')).toBeInTheDocument();
    });
    const checkbox = screen.getByTestId('shareable-row-show-missing') as HTMLInputElement;
    await act(async () => {
      fireEvent.click(checkbox);
    });
    const save = screen.getByTestId('shareable-row-save');
    await act(async () => {
      fireEvent.click(save);
    });
    await waitFor(() => {
      expect(api.state.shareables[0]?.showMissing).toBe(false);
    });
  });

  it('shows the delete-confirm copy after the first delete click', async () => {
    const api = createFakeSettingsApi();
    renderWithProviders(<ShareablesSettingsView api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('shareable-row-delete')).toBeInTheDocument();
    });
    const del = screen.getByTestId('shareable-row-delete');
    await act(async () => {
      fireEvent.click(del);
    });
    expect(screen.getByTestId('shareable-row-delete-confirm-copy')).toBeInTheDocument();
  });

  it('removes the shareable from the list after the second confirm-delete click', async () => {
    const api = createFakeSettingsApi();
    renderWithProviders(<ShareablesSettingsView api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('shareable-row-delete')).toBeInTheDocument();
    });
    const del = screen.getByTestId('shareable-row-delete');
    await act(async () => {
      fireEvent.click(del);
    });
    await act(async () => {
      fireEvent.click(del);
    });
    await waitFor(() => {
      expect(api.state.shareables).toHaveLength(0);
    });
    expect(screen.getByTestId('settings-shareables-empty')).toBeInTheDocument();
  });

  it('rolls back the list on a delete error', async () => {
    const api = createFakeSettingsApi();
    api.setDeleteShareableError(new Error('nope'));
    renderWithProviders(<ShareablesSettingsView api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('shareable-row-delete')).toBeInTheDocument();
    });
    const del = screen.getByTestId('shareable-row-delete');
    await act(async () => {
      fireEvent.click(del);
    });
    await act(async () => {
      fireEvent.click(del);
    });
    await waitFor(() => {
      expect(screen.getByTestId('shareable-row-error')).toBeInTheDocument();
    });
    expect(api.state.shareables).toHaveLength(1);
  });

  it('rolls back a per-row save on update error', async () => {
    const api = createFakeSettingsApi();
    api.setUpdateShareableError(new Error('server says no'));
    renderWithProviders(<ShareablesSettingsView api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('shareable-row-show-photos')).toBeInTheDocument();
    });
    const checkbox = screen.getByTestId('shareable-row-show-photos') as HTMLInputElement;
    await act(async () => {
      fireEvent.click(checkbox);
    });
    const save = screen.getByTestId('shareable-row-save');
    await act(async () => {
      fireEvent.click(save);
    });
    await waitFor(() => {
      expect(screen.getByTestId('shareable-row-error')).toBeInTheDocument();
    });
    expect(api.state.shareables[0]?.showPhotos).toBe(false);
  });

  it('disables non-default theme options for free users', async () => {
    const api = createFakeSettingsApi();
    renderWithProviders(<ShareablesSettingsView api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('shareable-row-theme-select')).toBeInTheDocument();
    });
    const goldOpt = screen.getByTestId('shareable-row-theme-option-gold') as HTMLOptionElement;
    expect(goldOpt.disabled).toBe(true);
    expect(goldOpt.textContent).toContain('Pro');
    const defaultOpt = screen.getByTestId('shareable-row-theme-option-default') as HTMLOptionElement;
    expect(defaultOpt.disabled).toBe(false);
  });

  it('disables the "show collection value" toggle for free users', async () => {
    const api = createFakeSettingsApi();
    renderWithProviders(<ShareablesSettingsView api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('shareable-row-show-values')).toBeInTheDocument();
    });
    const checkbox = screen.getByTestId('shareable-row-show-values') as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
  });

  it('debounces the handle-availability check', async () => {
    const api = createFakeSettingsApi();
    api.setHandleTaken('taken-handle');
    renderWithProviders(<ShareablesSettingsView api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('profile-handle-input')).toBeInTheDocument();
    });
    const handleInput = screen.getByTestId('profile-handle-input') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(handleInput, { target: { value: 'taken-handle' } });
    });
    expect(screen.getByTestId('profile-handle-availability').textContent).toContain('Checking');
    await waitFor(
      () => {
        expect(screen.getByTestId('profile-handle-availability').textContent).toContain(
          'already taken',
        );
      },
      { timeout: 1500 },
    );
  });

  it('surfaces "we will verify on save" when the backend endpoint is missing', async () => {
    const api = createFakeSettingsApi();
    api.setHandleAvailabilityError(new Error('404 not found'));
    renderWithProviders(<ShareablesSettingsView api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('profile-handle-input')).toBeInTheDocument();
    });
    const handleInput = screen.getByTestId('profile-handle-input') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(handleInput, { target: { value: 'pablo-99' } });
    });
    await waitFor(
      () => {
        expect(screen.getByTestId('profile-handle-availability').textContent).toContain('verify');
      },
      { timeout: 1500 },
    );
  });

  it('blocks profile save when bio exceeds 280 chars', async () => {
    const api = createFakeSettingsApi();
    renderWithProviders(<ShareablesSettingsView api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('profile-bio-input')).toBeInTheDocument();
    });
    const bio = screen.getByTestId('profile-bio-input') as HTMLTextAreaElement;
    const longBio = 'x'.repeat(281);
    await act(async () => {
      fireEvent.change(bio, { target: { value: longBio } });
    });
    const saveBtn = screen.getByTestId('profile-fields-save');
    expect(saveBtn.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByTestId('profile-bio-counter').textContent).toContain('limited to 280');
  });

  it('blocks profile save when handle is invalid', async () => {
    const api = createFakeSettingsApi();
    renderWithProviders(<ShareablesSettingsView api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('profile-handle-input')).toBeInTheDocument();
    });
    const handleInput = screen.getByTestId('profile-handle-input') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(handleInput, { target: { value: 'pa' } });
    });
    const saveBtn = screen.getByTestId('profile-fields-save');
    expect(saveBtn.getAttribute('aria-disabled')).toBe('true');
  });
});
