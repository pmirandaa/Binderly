// `apps/mobile/src/scanner/ui` — public barrel.
//
// T-SC-UX owns this tree. External callers import only from here;
// deep imports into individual component files are not part of the
// public surface.

export { DisambigPicker, buildDisambigCandidates } from './DisambigPicker.js';
export type { DisambigCandidate, DisambigPickerProps } from './DisambigPicker.js';

export { HoldSteadyHint, MatchOverlay } from './MatchOverlay.js';
export type { MatchOverlayProps } from './MatchOverlay.js';

export { ScannerError } from './ScannerError.js';
export type { ScannerErrorProps } from './ScannerError.js';

export { ScannerLoading } from './ScannerLoading.js';
export type { ScannerLoadingProps } from './ScannerLoading.js';

export { SessionFooter } from './SessionFooter.js';
export type { SessionFooterProps } from './SessionFooter.js';

export { StackPanel } from './StackPanel.js';
export type { StackPanelProps } from './StackPanel.js';

export { StabilityIndicator } from './StabilityIndicator.js';
export type { StabilityIndicatorProps } from './StabilityIndicator.js';

export { UndoToast } from './UndoToast.js';
export type { UndoToastProps } from './UndoToast.js';

export type {
  ModelLoadPhase,
  ModelLoadState,
  ScannerPhase,
  SessionItem,
  UndoEntry,
} from './types.js';

export { SESSION_ITEM_CAP, UNDO_TIMEOUT_MS } from './types.js';
