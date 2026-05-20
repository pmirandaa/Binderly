import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CameraPermissionPrompt } from './CameraPermissionPrompt.js';
import { renderWithProvider } from '../../../test-utils/render.js';

import type { CameraPermissionFlowStatus } from '../permissions.js';

function renderPrompt(
  status: CameraPermissionFlowStatus,
  handlers: Partial<{
    request: () => Promise<unknown>;
    settings: () => Promise<unknown>;
    cancel: () => void;
  }> = {},
) {
  return renderWithProvider(
    <CameraPermissionPrompt
      status={status}
      onRequestPermission={handlers.request ?? vi.fn()}
      onOpenSettings={handlers.settings ?? vi.fn()}
      onCancel={handlers.cancel}
    />,
  );
}

describe('<CameraPermissionPrompt>', () => {
  it('shows the first-launch copy and an "Allow camera" CTA for `not-determined`', () => {
    const view = renderPrompt('not-determined');
    expect(view.container.textContent).toContain('Scan your cards with the camera');
    expect(view.container.textContent).toContain('they never leave the device');
    expect(view.queryByTestId('camera-permission-primary')).not.toBeNull();
  });

  it('triggers `onRequestPermission` from the not-determined branch', () => {
    const request = vi.fn(async () => undefined);
    const view = renderPrompt('not-determined', { request });

    fireEvent.click(view.getByTestId('camera-permission-primary'));

    expect(request).toHaveBeenCalledTimes(1);
  });

  it('shows the "Open Settings" copy and CTA for `denied`', () => {
    const view = renderPrompt('denied');
    expect(view.container.textContent).toContain('Camera access is turned off');
    expect(view.queryByTestId('camera-permission-primary')).not.toBeNull();
  });

  it('triggers `onOpenSettings` from the denied branch', () => {
    const settings = vi.fn(async () => undefined);
    const view = renderPrompt('denied', { settings });

    fireEvent.click(view.getByTestId('camera-permission-primary'));

    expect(settings).toHaveBeenCalledTimes(1);
  });

  it('renders a non-actionable explanation for `restricted`', () => {
    const view = renderPrompt('restricted');
    expect(view.container.textContent).toContain('Camera access is restricted');
    expect(view.queryByTestId('camera-permission-primary')).toBeNull();
  });

  it('does not call `onRequestPermission` from the denied branch', () => {
    const request = vi.fn(async () => undefined);
    const settings = vi.fn(async () => undefined);
    const view = renderPrompt('denied', { request, settings });

    fireEvent.click(view.getByTestId('camera-permission-primary'));

    expect(request).not.toHaveBeenCalled();
    expect(settings).toHaveBeenCalledTimes(1);
  });

  it('renders a "Not now" cancel button only when `onCancel` is provided', () => {
    const without = renderPrompt('not-determined');
    expect(without.queryByTestId('camera-permission-cancel')).toBeNull();

    const cancel = vi.fn();
    const withHandler = renderPrompt('not-determined', { cancel });
    fireEvent.click(withHandler.getByTestId('camera-permission-cancel'));
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
