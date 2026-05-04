import { describe, expect, it } from 'vitest';

import { detectLanguage } from './language.js';

describe('detectLanguage — JP positive signals', () => {
  it('matches "japanese"', () => {
    const r = detectLanguage('japanese charizard', 'japanese charizard');
    expect(r.language).toBe('jp');
  });

  it('matches "japan"', () => {
    expect(detectLanguage('pokemon japan version', 'pokemon japan version').language).toBe('jp');
  });

  it('matches "jpn"', () => {
    expect(detectLanguage('jpn charizard', 'jpn charizard').language).toBe('jp');
  });

  it('matches bare "jp" but not when followed by digits', () => {
    expect(detectLanguage('jp charizard', 'jp charizard').language).toBe('jp');
    expect(detectLanguage('jp 102 charizard', 'jp 102 charizard').language).toBe('unknown');
  });

  it('detects CJK script in raw title', () => {
    const r = detectLanguage('pokemon リザードン', 'pokemon リザードン');
    expect(r.language).toBe('jp');
    expect(r.signals).toContain('language:jp-script');
  });

  it('does NOT redact "1st edition" (variants pass needs it)', () => {
    const r = detectLanguage('1st edition japanese charizard', '1st edition japanese charizard');
    expect(r.language).toBe('jp');
    expect(r.remaining).toContain('1st edition');
  });
});

describe('detectLanguage — EN positive signals', () => {
  it('matches "english"', () => {
    expect(detectLanguage('english charizard', 'english charizard').language).toBe('en');
  });

  it('matches "wotc"', () => {
    expect(detectLanguage('wotc charizard', 'wotc charizard').language).toBe('en');
  });
});

describe('detectLanguage — defaults', () => {
  it('returns unknown when no signal fires', () => {
    expect(detectLanguage('charizard 4/102 base set', 'charizard 4/102 base set').language).toBe(
      'unknown',
    );
  });
});
