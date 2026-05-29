// Unit tests for the plain-ESM `db:migrate` wrapper (#FU-1) — its target
// resolution + the graceful journal-planning logic (#FU-7).

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MigrateUsageError, parseUrlFlag, planMigration, resolveTarget } from '../scripts/migrate.mjs';

describe('parseUrlFlag', () => {
  it('returns the value following --url', () => {
    expect(parseUrlFlag(['--url', 'postgres://x'])).toBe('postgres://x');
  });

  it('returns the value following the -u alias', () => {
    expect(parseUrlFlag(['-u', 'postgres://y'])).toBe('postgres://y');
  });

  it('returns undefined when the flag is absent', () => {
    expect(parseUrlFlag(['--other', 'z'])).toBeUndefined();
  });

  it('throws a usage error when --url has no argument', () => {
    expect(() => parseUrlFlag(['--url'])).toThrow(MigrateUsageError);
  });
});

describe('resolveTarget', () => {
  it('prefers the --url flag over the environment', () => {
    expect(
      resolveTarget(['--url', 'postgres://flag'], {
        DATABASE_URL: 'postgres://env',
        SUPABASE_DB_URL: 'postgres://sup',
      }),
    ).toEqual({ url: 'postgres://flag', source: 'flag' });
  });

  it('falls back to DATABASE_URL before SUPABASE_DB_URL', () => {
    expect(
      resolveTarget([], { DATABASE_URL: 'postgres://env', SUPABASE_DB_URL: 'postgres://sup' }),
    ).toEqual({ url: 'postgres://env', source: 'DATABASE_URL' });
  });

  it('falls back to SUPABASE_DB_URL when DATABASE_URL is unset', () => {
    expect(resolveTarget([], { SUPABASE_DB_URL: 'postgres://sup' })).toEqual({
      url: 'postgres://sup',
      source: 'SUPABASE_DB_URL',
    });
  });

  it('returns null when no target is available', () => {
    expect(resolveTarget([], {})).toBeNull();
  });
});

describe('planMigration (#FU-7 graceful skip)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'binderly-migrate-'));
    mkdirSync(path.join(dir, 'meta'), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const writeJournal = (value: unknown): void => {
    writeFileSync(path.join(dir, 'meta', '_journal.json'), JSON.stringify(value));
  };
  const writeSql = (tag: string): void => {
    writeFileSync(path.join(dir, `${tag}.sql`), '-- noop\n');
  };

  it('skips gracefully when the journal is missing', () => {
    const plan = planMigration(dir);
    expect(plan.status).toBe('skip');
    if (plan.status === 'skip') {
      expect(plan.reason).toBe('no-journal');
      expect(plan.message).toContain('nothing to apply');
    }
  });

  it('skips gracefully when the journal has no entries', () => {
    writeJournal({ version: '7', dialect: 'postgresql', entries: [] });
    const plan = planMigration(dir);
    expect(plan.status).toBe('skip');
    if (plan.status === 'skip') {
      expect(plan.reason).toBe('empty-journal');
    }
  });

  it('skips gracefully when the journal is unparseable', () => {
    writeFileSync(path.join(dir, 'meta', '_journal.json'), '{ not json');
    const plan = planMigration(dir);
    expect(plan.status).toBe('skip');
    if (plan.status === 'skip') {
      expect(plan.reason).toBe('unparseable-journal');
    }
  });

  it('plans an apply with no missing files when every SQL file exists', () => {
    writeJournal({
      version: '7',
      dialect: 'postgresql',
      entries: [{ tag: '0000_init' }, { tag: '0001_more' }],
    });
    writeSql('0000_init');
    writeSql('0001_more');
    const plan = planMigration(dir);
    expect(plan.status).toBe('apply');
    if (plan.status === 'apply') {
      expect(plan.entries).toHaveLength(2);
      expect(plan.missingFiles).toEqual([]);
    }
  });

  it('flags journal entries whose SQL file is missing on disk', () => {
    writeJournal({
      version: '7',
      dialect: 'postgresql',
      entries: [{ tag: '0000_init' }, { tag: '0001_missing' }],
    });
    writeSql('0000_init');
    const plan = planMigration(dir);
    expect(plan.status).toBe('apply');
    if (plan.status === 'apply') {
      expect(plan.missingFiles).toEqual(['0001_missing']);
    }
  });
});
