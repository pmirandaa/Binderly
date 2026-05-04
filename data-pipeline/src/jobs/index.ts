// Top-level barrel for the data-pipeline runtime jobs (the pieces a
// cron / Edge Function actually invokes, as opposed to the adapters
// they consume internally). Each job task owns ONLY its designated
// section below — append your re-export when your job lands. Do NOT
// remove section headers, do NOT touch other jobs' sections. This
// keeps parallel-dispatched job tasks from conflicting on this file
// (same pattern as `src/adapters/index.ts`).

// ============================================================
// === T-DL-FX-RATES ===
// ============================================================
export * from './fx-rates.js';
