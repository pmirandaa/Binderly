// Hard-constraint test — `scanner/ui/` pure components must not
// import any network-side modules. Collection writes live in the
// screen layer (`screens/scan/`), not in this tree.
//
// Mirrors the pattern from `grading/capture/__tests__/network-isolation.test.ts`.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const UI_ROOT = join(__dirname, '..');

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

describe('scanner/ui network isolation', () => {
  it('does not import any network-side modules or use fetch / XMLHttpRequest', () => {
    const files = walk(UI_ROOT);
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
