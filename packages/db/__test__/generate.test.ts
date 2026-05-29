// Unit tests for the plain-ESM `db:generate` wrapper (#FU-1) — the
// migration-naming convention + the journal/SQL-count invariant checks.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  MIGRATION_NAME_RE,
  evaluateConventions,
  listSqlMigrations,
  readJournal,
} from '../scripts/generate.mjs';

describe('MIGRATION_NAME_RE', () => {
  it('accepts the canonical NNNN_<snake_case>.sql shape', () => {
    expect(MIGRATION_NAME_RE.test('0000_user_tables.sql')).toBe(true);
    expect(MIGRATION_NAME_RE.test('0023_paddle_webhook_log.sql')).toBe(true);
  });

  it('rejects non-conforming names', () => {
    expect(MIGRATION_NAME_RE.test('1_users.sql')).toBe(false);
    expect(MIGRATION_NAME_RE.test('0000_UserTables.sql')).toBe(false);
    expect(MIGRATION_NAME_RE.test('0000_user_tables.ts')).toBe(false);
    expect(MIGRATION_NAME_RE.test('0000-user-tables.sql')).toBe(false);
  });
});

describe('listSqlMigrations / readJournal', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'binderly-generate-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns sorted .sql files and ignores non-SQL', () => {
    writeFileSync(path.join(dir, '0001_b.sql'), 'x');
    writeFileSync(path.join(dir, '0000_a.sql'), 'x');
    writeFileSync(path.join(dir, 'notes.md'), 'x');
    expect(listSqlMigrations(dir)).toEqual(['0000_a.sql', '0001_b.sql']);
  });

  it('returns [] for a non-existent directory', () => {
    expect(listSqlMigrations(path.join(dir, 'nope'))).toEqual([]);
  });

  it('parses a valid journal and returns undefined for a missing one', () => {
    const journalPath = path.join(dir, '_journal.json');
    writeFileSync(journalPath, JSON.stringify({ version: '7', entries: [] }));
    expect(readJournal(journalPath)).toMatchObject({ version: '7' });
    expect(readJournal(path.join(dir, 'missing.json'))).toBeUndefined();
  });
});

describe('evaluateConventions', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'binderly-conv-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('skips when no new SQL files were produced', () => {
    const result = evaluateConventions({
      before: ['0000_a.sql'],
      after: ['0000_a.sql'],
      journal: { entries: [{}] },
      migrationsDir: dir,
    });
    expect(result.status).toBe('skip');
  });

  it('passes when a new, well-named, non-empty migration lands with a matching journal', () => {
    writeFileSync(path.join(dir, '0001_new_table.sql'), 'CREATE TABLE foo();');
    const result = evaluateConventions({
      before: ['0000_a.sql'],
      after: ['0000_a.sql', '0001_new_table.sql'],
      journal: { entries: [{}, {}] },
      migrationsDir: dir,
    });
    expect(result.status).toBe('ok');
    expect(result.message).toContain('0001_new_table.sql');
  });

  it('flags a convention violation for a badly-named migration', () => {
    writeFileSync(path.join(dir, 'BadName.sql'), 'x');
    const result = evaluateConventions({
      before: [],
      after: ['BadName.sql'],
      journal: { entries: [{}] },
      migrationsDir: dir,
    });
    expect(result.status).toBe('violation');
  });

  it('flags an empty generated migration', () => {
    writeFileSync(path.join(dir, '0001_empty.sql'), '   ');
    const result = evaluateConventions({
      before: [],
      after: ['0001_empty.sql'],
      journal: { entries: [{}] },
      migrationsDir: dir,
    });
    expect(result.status).toBe('violation');
  });

  it('flags a journal that is missing entries for the SQL files on disk', () => {
    writeFileSync(path.join(dir, '0000_a.sql'), 'CREATE TABLE a();');
    writeFileSync(path.join(dir, '0001_new.sql'), 'CREATE TABLE foo();');
    const result = evaluateConventions({
      before: [],
      after: ['0000_a.sql', '0001_new.sql'],
      journal: { entries: [{}] },
      migrationsDir: dir,
    });
    expect(result.status).toBe('violation');
    expect(result.message).toContain('_journal.json');
  });

  it('flags a missing journal entirely', () => {
    writeFileSync(path.join(dir, '0001_new.sql'), 'CREATE TABLE foo();');
    const result = evaluateConventions({
      before: [],
      after: ['0001_new.sql'],
      journal: undefined,
      migrationsDir: dir,
    });
    expect(result.status).toBe('violation');
  });
});
