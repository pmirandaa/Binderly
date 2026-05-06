import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PageLoading } from './PageLoading.js';
import { renderWithProviders } from '../../test-utils/render.js';

describe('PageLoading', () => {
  it('renders the default label', () => {
    renderWithProviders(<PageLoading />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('respects a custom label', () => {
    renderWithProviders(<PageLoading label="Fetching cards" />);
    expect(screen.getByText('Fetching cards')).toBeInTheDocument();
  });

  it('exposes at least one status region (Spinner role + outer wrapper)', () => {
    renderWithProviders(<PageLoading />);
    const statuses = screen.getAllByRole('status');
    expect(statuses.length).toBeGreaterThan(0);
    // The outer wrapper is aria-live=polite.
    expect(statuses.some((el) => el.getAttribute('aria-live') === 'polite')).toBe(true);
  });
});
