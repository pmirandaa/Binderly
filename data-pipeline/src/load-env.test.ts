import { describe, expect, it } from 'vitest';

import { applyEnv, envCandidates, parseEnv } from './load-env.js';

describe('parseEnv', () => {
  it('parses KEY=VALUE pairs, ignoring comments and blanks', () => {
    const parsed = parseEnv(['# comment', '', 'FOO=bar', 'BAZ=qux'].join('\n'));
    expect(parsed).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('strips an optional leading `export` and surrounding quotes', () => {
    const parsed = parseEnv(['export FOO="bar"', "BAZ='qux'"].join('\n'));
    expect(parsed).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('keeps `=` characters inside the value (e.g. connection strings)', () => {
    const parsed = parseEnv('DATABASE_URL=postgresql://u:p@localhost:54322/db?sslmode=disable');
    expect(parsed['DATABASE_URL']).toBe('postgresql://u:p@localhost:54322/db?sslmode=disable');
  });

  it('ignores malformed lines without an `=`', () => {
    expect(parseEnv('NOT_A_PAIR')).toEqual({});
  });
});

describe('applyEnv', () => {
  it('sets keys that are not already present', () => {
    const env: NodeJS.ProcessEnv = {};
    const applied = applyEnv({ FOO: 'bar' }, env);
    expect(env['FOO']).toBe('bar');
    expect(applied).toEqual(['FOO']);
  });

  it('never overwrites an already-set value', () => {
    const env: NodeJS.ProcessEnv = { FOO: 'real' };
    const applied = applyEnv({ FOO: 'fromfile' }, env);
    expect(env['FOO']).toBe('real');
    expect(applied).toEqual([]);
  });
});

describe('envCandidates', () => {
  it('lists the package-local .env before the monorepo-root .env', () => {
    const candidates = envCandidates('/repo/data-pipeline');
    expect(candidates[0]).toBe('/repo/data-pipeline/.env');
    expect(candidates[1]).toBe('/repo/.env');
  });
});
