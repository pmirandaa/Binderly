import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MemberTile } from './MemberTile';
import { makePublicShareMember } from '../../lib/share/fixtures';
import { renderWithProviders } from '../../test-utils/render';

describe('MemberTile', () => {
  it('renders the card name, number, set name, and variant', () => {
    const member = makePublicShareMember({
      cardName: 'Charizard',
      cardNumber: '4',
      setName: 'Base Set',
      variantLabel: 'Holo',
    });
    renderWithProviders(<MemberTile member={member} />);
    expect(screen.getByTestId('share-member-name')).toHaveTextContent('#4');
    expect(screen.getByTestId('share-member-name')).toHaveTextContent('Charizard');
    expect(screen.getByTestId('share-member-set')).toHaveTextContent('Base Set');
    expect(screen.getByTestId('share-member-set')).toHaveTextContent('Holo');
  });

  it('links to /cards/[printingId] (NOT cardId)', () => {
    const member = makePublicShareMember({ printingId: 'p-xyz', cardId: 'card-xyz' });
    renderWithProviders(<MemberTile member={member} />);
    const link = screen.getByTestId('share-member-link');
    expect(link.getAttribute('href')).toBe('/cards/p-xyz');
  });

  it('encodes path-unsafe characters in the link', () => {
    const member = makePublicShareMember({ printingId: 'has space/slash' });
    renderWithProviders(<MemberTile member={member} />);
    expect(screen.getByTestId('share-member-link').getAttribute('href')).toBe(
      '/cards/has%20space%2Fslash',
    );
  });

  it('renders an alt text containing card name, set code and number', () => {
    const member = makePublicShareMember({
      cardName: 'Mew',
      cardNumber: '12',
      setCode: 'swsh10',
    });
    renderWithProviders(<MemberTile member={member} />);
    const img = screen.getByTestId('share-member-image') as HTMLImageElement;
    expect(img.alt).toBe('Mew (swsh10 #12)');
  });

  it('renders a fallback when no image is available', () => {
    const member = makePublicShareMember({ imageUrl: null });
    renderWithProviders(<MemberTile member={member} />);
    expect(screen.getByTestId('share-member-fallback')).toBeInTheDocument();
    expect(screen.queryByTestId('share-member-image')).toBeNull();
  });

  it('hides the quantity badge for quantity 1', () => {
    renderWithProviders(<MemberTile member={makePublicShareMember({ quantity: 1 })} />);
    expect(screen.queryByTestId('share-member-quantity')).toBeNull();
  });

  it('shows the quantity badge when quantity > 1', () => {
    renderWithProviders(<MemberTile member={makePublicShareMember({ quantity: 3 })} />);
    expect(screen.getByTestId('share-member-quantity')).toHaveTextContent('×3');
  });
});
