import { describe, expect, it } from 'vitest';

import { CameraPreview } from './CameraPreview.js';
import { renderWithProvider } from '../../../test-utils/render.js';
import { setMockCameraDevice } from '../../../test-utils/setup.js';
import { createFrameTelemetrySink } from '../frame-telemetry.js';
import { createStackModeDetector } from '../stack-mode.js';

describe('<CameraPreview>', () => {
  it('renders the underlying Camera when a device is available', () => {
    const telemetrySink = createFrameTelemetrySink();
    const stackModeDetector = createStackModeDetector();

    const view = renderWithProvider(
      <CameraPreview
        isActive
        telemetrySink={telemetrySink}
        stackModeDetector={stackModeDetector}
      />,
    );

    expect(view.queryByTestId('scan-camera-preview')).not.toBeNull();
    expect(view.queryByTestId('scan-camera-no-device')).toBeNull();
  });

  it('renders the no-device fallback when `useCameraDevice` returns null', () => {
    setMockCameraDevice(null);

    const telemetrySink = createFrameTelemetrySink();
    const stackModeDetector = createStackModeDetector();

    const view = renderWithProvider(
      <CameraPreview
        isActive={false}
        telemetrySink={telemetrySink}
        stackModeDetector={stackModeDetector}
      />,
    );

    expect(view.queryByTestId('scan-camera-no-device')).not.toBeNull();
    expect(view.queryByTestId('scan-camera-preview')).toBeNull();
  });

  it('does not render the no-device fallback for an inactive preview when device exists', () => {
    const telemetrySink = createFrameTelemetrySink();
    const stackModeDetector = createStackModeDetector();

    const view = renderWithProvider(
      <CameraPreview
        isActive={false}
        telemetrySink={telemetrySink}
        stackModeDetector={stackModeDetector}
      />,
    );

    expect(view.queryByTestId('scan-camera-preview')).not.toBeNull();
  });
});
