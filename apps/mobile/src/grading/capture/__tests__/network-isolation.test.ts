// Hard-constraint test — the grading/capture tree must not contain
// any network-side imports. The full grading pipeline writes
// captures to R2 / `grading_submission` rows downstream, but the
// capture-flow task is explicitly on-device only.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const CAPTURE_ROOT = join(__dirname, '..');

const FORBIDDEN_PATTERNS: ReadonlyArray<RegExp> = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /from\s+['"]@binderly\/api-client/,
  /from\s+['"]@supabase\/supabase-js/,
  /from\s+['"]expo-auth-session/,
];

function walk(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    if (entry === '__tests__') continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...walk(full));
    } else if (full.endsWith('.ts') || full.endsWith('.tsx')) {
      files.push(full);
    }
  }
  return files;
}

describe('grading/capture network isolation', () => {
  it('does not import any network-side modules or use fetch / XMLHttpRequest', () => {
    const files = walk(CAPTURE_ROOT);
    const offenders: string[] = [];
    for (const file of files) {
      const contents = readFileSync(file, 'utf8');
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(contents)) {
          offenders.push(`${file}: ${pattern.source}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
