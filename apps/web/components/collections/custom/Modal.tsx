'use client';

// Lightweight modal primitive used by the create / delete /
// printing-picker flows. `@binderly/ui` does not yet ship a Modal
// component (see T-SP-UI-TOKENS / future T-SP-UI-MODAL); rather
// than depend on a forthcoming package and stall this task, we
// roll a small backdrop + centered surface out of the existing
// `<YStack>` primitive. CSS-only, web-only — fine because this is
// the web app.
//
// A11y: `role="dialog"` + `aria-modal="true"` + an aria-labelled-by
// hook for the heading. Backdrop click and Escape both close. Focus
// trap is intentionally not implemented yet — the modals here have
// at most a handful of focusable elements; T-W-A11Y-AUDIT will
// revisit globally.

import { useEffect, useId, type ReactNode } from 'react';

import { YStack } from '@binderly/ui';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /**
   * Optional max-width for the dialog surface. Defaults to a
   * reasonable mid-size; the printing-picker overrides to wider
   * because it renders a card grid.
   */
  maxWidth?: number;
  testId?: string;
}

const BACKDROP_STYLE: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.5)',
  zIndex: 100,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px',
};

export function Modal({
  open,
  onClose,
  title,
  children,
  maxWidth = 480,
  testId,
}: ModalProps): React.ReactNode {
  const headingId = useId();

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return (): void => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      style={BACKDROP_STYLE}
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      data-testid={testId !== undefined ? `${testId}-backdrop` : undefined}
    >
      <YStack
        backgroundColor="$surface"
        borderRadius={12}
        padding="$5"
        gap="$4"
        width="100%"
        maxWidth={maxWidth}
        role="dialog"
        aria-modal={true}
        aria-labelledby={headingId}
        data-testid={testId}
        style={{ maxHeight: '90vh', overflow: 'auto' }}
      >
        <YStack
          gap="$1"
          id={headingId}
          data-testid={testId !== undefined ? `${testId}-title` : undefined}
        >
          {/* Render the title as the dialog's heading. We keep this
              tiny so callers control internal spacing themselves. */}
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{title}</h2>
        </YStack>
        {children}
      </YStack>
    </div>
  );
}
