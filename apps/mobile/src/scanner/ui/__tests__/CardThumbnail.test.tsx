// `<CardThumbnail>` (FU-34) — image vs placeholder across the four
// states: loading (no url yet), success (url renders), error (image
// fails → placeholder), and no-image (null url → placeholder).
//
// The global setup mocks `expo-image` to render `null`; we re-mock it
// locally so the rendered `<img>` is queryable and its `onError` can be
// fired to exercise the fallback latch.

import { fireEvent } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProvider } from '../../../test-utils/render.js';
import { CardThumbnail } from '../CardThumbnail.js';

interface MockImageProps {
  source?: { uri?: string };
  onError?: () => void;
  testID?: string;
  accessibilityLabel?: string;
}

vi.mock('expo-image', () => ({
  Image: ({ source, onError, testID, accessibilityLabel }: MockImageProps) =>
    React.createElement('img', {
      'data-testid': testID,
      src: source?.uri,
      'aria-label': accessibilityLabel,
      onError: () => onError?.(),
    }),
}));

describe('<CardThumbnail>', () => {
  it('shows the placeholder while there is no url (loading state)', () => {
    const view = renderWithProvider(<CardThumbnail url={null} label="4/102" />);
    expect(view.queryByTestId('card-thumbnail-placeholder')).not.toBeNull();
    expect(view.queryByTestId('card-thumbnail-image')).toBeNull();
  });

  it('shows the placeholder for an empty-string url', () => {
    const view = renderWithProvider(<CardThumbnail url="" label="X" />);
    expect(view.queryByTestId('card-thumbnail-placeholder')).not.toBeNull();
  });

  it('renders the image when a url is provided (success state)', () => {
    const view = renderWithProvider(
      <CardThumbnail url="https://img.example/c.png" label="4/102" />,
    );
    const img = view.queryByTestId('card-thumbnail-image');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('https://img.example/c.png');
    expect(view.queryByTestId('card-thumbnail-placeholder')).toBeNull();
  });

  it('falls back to the placeholder when the image errors', () => {
    const view = renderWithProvider(
      <CardThumbnail url="https://img.example/broken.png" label="4/102" />,
    );
    const img = view.getByTestId('card-thumbnail-image');
    fireEvent.error(img);
    expect(view.queryByTestId('card-thumbnail-image')).toBeNull();
    expect(view.queryByTestId('card-thumbnail-placeholder')).not.toBeNull();
  });

  it('truncates the placeholder label to four characters', () => {
    const view = renderWithProvider(
      <CardThumbnail url={null} label="ABCDEFGH" />,
    );
    expect(view.getByTestId('card-thumbnail-placeholder').textContent).toBe('ABCD');
  });

  it('shows an em-dash placeholder when no label is given', () => {
    const view = renderWithProvider(<CardThumbnail url={null} />);
    expect(view.getByTestId('card-thumbnail-placeholder').textContent).toBe('—');
  });

  it('re-attempts the image when the url changes after an error', () => {
    const view = renderWithProvider(
      <CardThumbnail url="https://img.example/a.png" />,
    );
    fireEvent.error(view.getByTestId('card-thumbnail-image'));
    expect(view.queryByTestId('card-thumbnail-image')).toBeNull();

    view.rerender(<CardThumbnail url="https://img.example/b.png" />);
    const img = view.queryByTestId('card-thumbnail-image');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('https://img.example/b.png');
  });

  it('honours a custom testID', () => {
    const view = renderWithProvider(
      <CardThumbnail url={null} testID="match-overlay-thumbnail" />,
    );
    expect(view.queryByTestId('match-overlay-thumbnail-placeholder')).not.toBeNull();
  });
});
