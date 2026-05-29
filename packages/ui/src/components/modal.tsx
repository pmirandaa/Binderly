// `<Modal>` — cross-platform overlay dialog. A backdrop +
// centered surface built on `@tamagui/core` primitives so it forks
// to web (`div`) and native (`View`) like every other `@binderly/ui`
// component. Hoisted from the ad-hoc per-app modals (web custom
// collections, etc.) so consumers stop re-rolling the same surface.
//
// API mirrors the previous in-tree web modal: controlled `open`,
// an `onClose` that fires on backdrop press (web + native) and the
// Escape key (web), a `title` rendered as the dialog heading, and a
// `maxWidth` cap on the surface.
//
// A11y: `role="dialog"` + `aria-modal` + `aria-labelledby` on web;
// `accessibilityViewIsModal` + a heading role on native. Focus trap
// is intentionally out of scope (matches the prior in-tree modal);
// a global a11y pass can layer one on without an API change.

import { Stack as TamaguiStack, Text as TamaguiText, styled } from '@tamagui/core';
import { useEffect, useId, type ReactNode } from 'react';

import { zIndex } from '../tokens/z-index.js';

// `document` only exists on web — used to (a) swap the overlay to
// `position: fixed` so it covers the viewport regardless of scroll,
// and (b) wire the Escape-to-close key listener. On native both are
// skipped and the absolute-fill overlay covers its root container.
const IS_WEB = typeof document !== 'undefined';

const Backdrop = styled(TamaguiStack, {
  name: 'BinderlyModalBackdrop',
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.5)',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
});

const Surface = styled(TamaguiStack, {
  name: 'BinderlyModalSurface',
  flexDirection: 'column',
  backgroundColor: '$surface',
  borderRadius: 12,
  padding: 20,
  gap: 16,
  width: '100%',
});

const TitleText = styled(TamaguiText, {
  name: 'BinderlyModalTitle',
  color: '$text',
  fontSize: 20,
  fontWeight: '600',
});

export interface ModalProps {
  /** Whether the modal is visible. Renders nothing when `false`. */
  open: boolean;
  /** Called on backdrop press (web + native) and Escape (web). */
  onClose: () => void;
  /** Dialog heading; also wired to `aria-labelledby`. */
  title: string;
  children: ReactNode;
  /** Max width of the surface in px. Defaults to 480. */
  maxWidth?: number;
  /** Test id — set on the surface; `${testID}-backdrop` on the backdrop. */
  testID?: string;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  maxWidth = 480,
  testID,
}: ModalProps): ReactNode {
  const headingId = useId();

  useEffect(() => {
    if (!open || !IS_WEB) return;
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
    <Backdrop
      zIndex={zIndex.modal}
      role="presentation"
      // Web overlays must be fixed to cover the scrolled viewport;
      // native keeps the styled `position: absolute` fill.
      style={IS_WEB ? { position: 'fixed' } : undefined}
      onPress={(event) => {
        // Close only when the backdrop itself is the press target —
        // presses inside the surface stop propagation below.
        const e = event as { target?: unknown; currentTarget?: unknown };
        if (e.target === undefined || e.target === e.currentTarget) {
          onClose();
        }
      }}
      data-testid={testID !== undefined ? `${testID}-backdrop` : undefined}
    >
      <Surface
        maxWidth={maxWidth}
        role="dialog"
        aria-modal={true}
        aria-labelledby={headingId}
        // Native-only RN a11y flag — spread so the key is entirely
        // absent on web, where `aria-modal` covers it and the raw
        // prop would otherwise leak to the DOM as an unknown attribute.
        {...(IS_WEB ? {} : { accessibilityViewIsModal: true })}
        onPress={(event) => {
          const e = event as { stopPropagation?: () => void };
          e.stopPropagation?.();
        }}
        style={IS_WEB ? { maxHeight: '90vh', overflowY: 'auto' } : undefined}
        data-testid={testID}
        testID={testID}
      >
        <TitleText id={headingId} accessibilityRole="header">
          {title}
        </TitleText>
        {children}
      </Surface>
    </Backdrop>
  );
}
