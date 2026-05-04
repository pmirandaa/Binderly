// Phase 1 schema barrel.
//
// Each schema task owns ONLY its designated section below — uncomment the
// listed re-exports as your task lands. Do NOT add lines outside your
// section, do NOT remove the section headers, do NOT touch other tasks'
// sections. This keeps parallel-dispatched schema tasks from conflicting
// on this file.
//
// The trailing `export {};` is a placeholder so this barrel is a valid
// TypeScript module until at least one schema is uncommented. Leave it
// in place; the orchestrator removes it during the merge commit of the
// first schema task to land.

// ============================================================
// === T-DL-SCHEMA-CARDS ===
// ============================================================
export * from './sets.js';
export * from './cards.js';
export * from './printings.js';

// ============================================================
// === T-DL-SCHEMA-USERS ===
// ============================================================
export * from './profiles.js';
export * from './subscriptions.js';

// ============================================================
// === T-DL-SCHEMA-COLLECTIONS ===
// ============================================================
// export * from "./collections.js";
// export * from "./custom_collections.js";
// export * from "./smart_rules.js";
// export * from "./shareables.js";

// ============================================================
// === T-DL-SCHEMA-GRADING ===
// ============================================================
// export * from "./grading.js";

// ============================================================
// === T-DL-SCHEMA-PRICING ===
// ============================================================
// export * from "./prices.js";
// export * from "./price_snapshots.js";

export {};
