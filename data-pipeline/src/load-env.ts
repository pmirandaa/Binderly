// load-env.ts — zero-dependency `.env` auto-loader for the data-pipeline
// CLI scripts (#FU-3). Importing this module for its side effect populates
// `process.env` from a `.env` file (package-local first, then the monorepo
// root) so smoke tests are genuine one-liners — no `export DATABASE_URL=…`
// preamble before every `pnpm --filter @binderly/data-pipeline <job>`.
//
// Real, already-exported environment variables always win: we never
// clobber a value the caller set explicitly (same posture as dotenv's
// default). Scripts add `import '../src/load-env.js';` as their first
// import so the file is read before any module reads `process.env`.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * Parse `.env` file contents into a plain record. Supports `KEY=VALUE`
 * lines, `# comments`, blank lines, an optional leading `export `, and
 * surrounding single/double quotes. Deliberately tiny — we only need the
 * shapes our own `.env.example` uses.
 */
export function parseEnv(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    let key = line.slice(0, eq).trim();
    if (key.startsWith('export ')) key = key.slice('export '.length).trim();
    if (key.length === 0) continue;
    let value = line.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Apply parsed entries to `env` without overwriting keys that already
 * have a value. Returns the list of keys actually applied.
 */
export function applyEnv(
  entries: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const applied: string[] = [];
  for (const [key, value] of Object.entries(entries)) {
    if (env[key] === undefined) {
      env[key] = value;
      applied.push(key);
    }
  }
  return applied;
}

/**
 * Candidate `.env` paths in precedence order: package-local first (so a
 * data-pipeline-specific override wins), then the monorepo root.
 */
export function envCandidates(packageRoot: string): string[] {
  return [path.join(packageRoot, '.env'), path.resolve(packageRoot, '..', '.env')];
}

/**
 * Load the first-found values from the candidate `.env` files into `env`.
 * "First wins" among files; real env vars always win over file values.
 */
export function loadEnv(packageRoot: string, env: NodeJS.ProcessEnv = process.env): void {
  for (const file of envCandidates(packageRoot)) {
    if (!existsSync(file)) continue;
    applyEnv(parseEnv(readFileSync(file, 'utf8')), env);
  }
}

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(PACKAGE_ROOT);
