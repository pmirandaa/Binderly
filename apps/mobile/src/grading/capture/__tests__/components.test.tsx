// Smaller-component contract tests — pin the per-piece behaviour
// the screen relies on without re-rendering the full screen tree.

import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProvider } from '../../../test-utils/render.js';
import { CaptureControls } from '../components/CaptureControls.js';
import { CaptureFeedbackBanner } from '../components/CaptureFeedbackBanner.js';
import { CaptureFramingOverlay } from '../components/CaptureFramingOverlay.js';
import { CaptureReviewModal } from '../components/CaptureReviewModal.js';
import { CaptureStepIndicator } from '../components/CaptureStepIndicator.js';
import { CAPTURE_STEPS } from '../constants.js';

import type { GradingShotKind } from '../types.js';

describe('<CaptureStepIndicator>', () => {
  it('renders one dot per step, marking accepted shots filled', () => {
    const accepted = new Set<GradingShotKind>(['frontFull', 'backFull']);
    const view = renderWithProvider(
      <CaptureStepIndicator
        steps={CAPTURE_STEPS}
        currentIndex={2}
        acceptedKinds={accepted}
      />,
    );
    expect(view.getByTestId('capture-step-dot-frontFull').getAttribute('data-state')).toBe(
      'accepted',
    );
    expect(view.getByTestId('capture-step-dot-backFull').getAttribute('data-state')).toBe(
      'accepted',
    );
    expect(view.getByTestId('capture-step-dot-frontCorner').getAttribute('data-state')).toBe(
      'current',
    );
    expect(view.getByTestId('capture-step-dot-backCorner').getAttribute('data-state')).toBe(
      'pending',
    );
    expect(view.container.textContent).toContain('Step 3 of 7');
  });

  it('caps the step text at the total when complete', () => {
    const accepted = new Set<GradingShotKind>([
      'frontFull',
      'backFull',
      'frontCorner',
      'backCorner',
    ]);
    const view = renderWithProvider(
      <CaptureStepIndicator
        steps={CAPTURE_STEPS}
        currentIndex={CAPTURE_STEPS.length}
        acceptedKinds={accepted}
      />,
    );
    expect(view.container.textContent).toContain('Step 7 of 7');
  });
});

describe('<CaptureFeedbackBanner>', () => {
  it('renders nothing when reason is null and defaultsToReady is false', () => {
    const view = renderWithProvider(<CaptureFeedbackBanner reason={null} />);
    expect(view.queryByTestId('capture-feedback-banner')).toBeNull();
  });

  it('renders the "great" copy when reason is null and defaultsToReady is true', () => {
    const view = renderWithProvider(
      <CaptureFeedbackBanner reason={null} defaultsToReady />,
    );
    expect(view.queryByTestId('capture-feedback-banner')).not.toBeNull();
    expect(view.container.textContent).toContain('Looks great');
  });

  it('renders the per-reason copy when a reason is set', () => {
    const view = renderWithProvider(<CaptureFeedbackBanner reason="blurry" />);
    expect(view.getByTestId('capture-feedback-banner').getAttribute('data-reason')).toBe(
      'blurry',
    );
    expect(view.container.textContent).toContain('Blurry');
  });
});

describe('<CaptureFramingOverlay>', () => {
  it('renders the full-portrait variant', () => {
    const view = renderWithProvider(
      <CaptureFramingOverlay kind="full-portrait" hint="Front of card" />,
    );
    expect(view.queryByTestId('capture-framing-overlay-full-portrait')).not.toBeNull();
    expect(view.queryByTestId('capture-framing-full')).not.toBeNull();
    expect(view.container.textContent).toContain('Front of card');
  });

  it('renders the corner-top-left variant', () => {
    const view = renderWithProvider(
      <CaptureFramingOverlay kind="corner-top-left" hint="Top-left" />,
    );
    expect(view.queryByTestId('capture-framing-overlay-corner-top-left')).not.toBeNull();
    expect(view.queryByTestId('capture-framing-corner-top-left')).not.toBeNull();
  });

  it('renders the corner-top-right variant', () => {
    const view = renderWithProvider(
      <CaptureFramingOverlay kind="corner-top-right" hint="Top-right" />,
    );
    expect(view.queryByTestId('capture-framing-overlay-corner-top-right')).not.toBeNull();
    expect(view.queryByTestId('capture-framing-corner-top-right')).not.toBeNull();
  });

  it('renders the corner-bottom-left variant', () => {
    const view = renderWithProvider(
      <CaptureFramingOverlay kind="corner-bottom-left" hint="Bottom-left" />,
    );
    expect(view.queryByTestId('capture-framing-overlay-corner-bottom-left')).not.toBeNull();
    expect(view.queryByTestId('capture-framing-corner-bottom-left')).not.toBeNull();
  });

  it('renders the corner-bottom-right variant', () => {
    const view = renderWithProvider(
      <CaptureFramingOverlay kind="corner-bottom-right" hint="Bottom-right" />,
    );
    expect(view.queryByTestId('capture-framing-overlay-corner-bottom-right')).not.toBeNull();
    expect(view.queryByTestId('capture-framing-corner-bottom-right')).not.toBeNull();
  });

  it('renders the surface-raking variant with a tilt indicator', () => {
    const view = renderWithProvider(
      <CaptureFramingOverlay kind="surface-raking" hint="Surface" />,
    );
    expect(view.queryByTestId('capture-framing-overlay-surface-raking')).not.toBeNull();
    expect(view.queryByTestId('capture-framing-surface')).not.toBeNull();
    expect(view.queryByTestId('capture-framing-surface-tilt')).not.toBeNull();
    expect(view.container.textContent).toContain('Tilt the phone');
  });
});

describe('<CaptureControls>', () => {
  it('renders the capture, cancel + reset buttons when showReset is true', () => {
    const view = renderWithProvider(
      <CaptureControls
        captureLabel="Capture"
        onCapture={(): void => undefined}
        onCancel={(): void => undefined}
        showReset
        onReset={(): void => undefined}
      />,
    );
    expect(view.queryByTestId('capture-take')).not.toBeNull();
    expect(view.queryByTestId('capture-cancel')).not.toBeNull();
    expect(view.queryByTestId('capture-reset')).not.toBeNull();
  });

  it('hides reset (spacer placeholder) when showReset is false', () => {
    const view = renderWithProvider(
      <CaptureControls
        captureLabel="Capture"
        onCapture={(): void => undefined}
        onCancel={(): void => undefined}
        showReset={false}
        onReset={(): void => undefined}
      />,
    );
    expect(view.queryByTestId('capture-reset')).toBeNull();
    expect(view.queryByTestId('capture-reset-spacer')).not.toBeNull();
  });

  it('suppresses onCapture when busy is true', () => {
    const onCapture = vi.fn();
    const view = renderWithProvider(
      <CaptureControls
        captureLabel="Capture"
        captureBusy
        onCapture={onCapture}
        onCancel={(): void => undefined}
        showReset={false}
        onReset={(): void => undefined}
      />,
    );
    fireEvent.click(view.getByTestId('capture-take'));
    expect(onCapture).not.toHaveBeenCalled();
  });

  it('fires onCancel when the cancel button is tapped', () => {
    const onCancel = vi.fn();
    const view = renderWithProvider(
      <CaptureControls
        captureLabel="Capture"
        onCapture={(): void => undefined}
        onCancel={onCancel}
        showReset={false}
        onReset={(): void => undefined}
      />,
    );
    fireEvent.click(view.getByTestId('capture-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('<CaptureReviewModal>', () => {
  it('renders nothing when visible is false', () => {
    const view = renderWithProvider(
      <CaptureReviewModal
        visible={false}
        stepTitle="Front of card"
        photoUri="file:///x.jpg"
        sharpness={10}
        brightness={0.5}
        coverage={0.5}
        onAccept={(): void => undefined}
        onRetake={(): void => undefined}
      />,
    );
    expect(view.queryByTestId('capture-review-modal')).toBeNull();
  });

  it('renders metrics + buttons when visible', () => {
    const onAccept = vi.fn();
    const onRetake = vi.fn();
    const view = renderWithProvider(
      <CaptureReviewModal
        visible
        stepTitle="Front of card"
        photoUri="file:///x.jpg"
        sharpness={12.5}
        brightness={0.6}
        coverage={0.7}
        onAccept={onAccept}
        onRetake={onRetake}
      />,
    );
    expect(view.queryByTestId('capture-review-modal')).not.toBeNull();
    expect(view.container.textContent).toContain('Sharpness 12.5');
    fireEvent.click(view.getByTestId('capture-review-retake'));
    fireEvent.click(view.getByTestId('capture-review-accept'));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onRetake).toHaveBeenCalledTimes(1);
  });
});
