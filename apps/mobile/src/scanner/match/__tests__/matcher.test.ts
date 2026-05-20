// Core matcher state-machine tests.
//
// The matcher is pure-JS (no React) so these tests drive it
// directly via `observe()`. We use a deterministic `now` function
// + manual control of mock `embedCrop` / `searchKNN` so the
// stability / cooldown / async-debounce paths are all observable.

import { describe, expect, it, vi } from 'vitest';

import { createMatcher } from '../matcher.js';

import type { MatcherDeps, MatcherHandle } from '../types.js';
import type { AnnSearchResult } from '@/scanner/ann';
import type { DetectionEvent } from '@/scanner/detect';

// ---- helpers ----------------------------------------------------------------

function event(
  ts: number,
  accepted = true,
  crop: Float32Array | null = accepted ? new Float32Array([0.1, 0.2, 0.3]) : null,
): DetectionEvent {
  return {
    ts,
    rect: { x: 0, y: 0, width: 50, height: 70 },
    rectValid: accepted,
    quality: {
      sharpness: 20,
      brightness: 0.5,
      aspectRatio: 1.4,
      portraitOrientation: true,
      sharpnessOK: accepted,
      brightnessOK: accepted,
      aspectOK: accepted,
    },
    accepted,
    cropped: crop,
  };
}

function ann(printingId: string, score: number): AnnSearchResult {
  return { printingId, score, distance: 1 - score };
}

interface Harness {
  matcher: MatcherHandle;
  embedSpy: ReturnType<typeof vi.fn>;
  searchSpy: ReturnType<typeof vi.fn>;
  nowSpy: ReturnType<typeof vi.fn>;
}

function harness(
  overrides: Partial<MatcherDeps> = {},
  initialResults: readonly AnnSearchResult[][] = [],
): Harness {
  const embedSpy = vi.fn(async (crop: Float32Array) => {
    // Return a small fake embedding — content doesn't matter
    // because we control searchKNN's output below.
    return new Float32Array([crop[0] ?? 0, 1, 2, 3]);
  });
  let resultsCursor = 0;
  const resultsQueue: AnnSearchResult[][] = [...initialResults];
  const searchSpy = vi.fn(
    (_query: Float32Array, _k: number): readonly AnnSearchResult[] => {
      void _query;
      void _k;
      const next = resultsQueue[resultsCursor];
      resultsCursor += 1;
      return next ?? [];
    },
  );
  let fakeTime = 1_000;
  const nowSpy = vi.fn(() => {
    fakeTime += 1;
    return fakeTime;
  });
  const matcher = createMatcher({
    embedCrop: embedSpy,
    searchKNN: searchSpy,
    now: nowSpy,
    ...overrides,
  });
  return { matcher, embedSpy, searchSpy, nowSpy };
}

// ---- tests ------------------------------------------------------------------

describe('createMatcher — construction', () => {
  it('throws when config.k < 3 (needs top-2 + disambig top-3)', () => {
    expect(() =>
      createMatcher({
        embedCrop: vi.fn(),
        searchKNN: vi.fn(),
        config: { k: 2 },
      }),
    ).toThrow(/k must be >= 3/);
  });

  it('throws when stabilityCount < 1', () => {
    expect(() =>
      createMatcher({
        embedCrop: vi.fn(),
        searchKNN: vi.fn(),
        config: { stabilityCount: 0 },
      }),
    ).toThrow(/stabilityCount/);
  });

  it('merges partial config over the defaults', () => {
    const { matcher } = harness({ config: { autoAddScore: 0.5 } });
    expect(matcher.config.autoAddScore).toBe(0.5);
    expect(matcher.config.disambigScore).toBeGreaterThan(0); // default preserved
  });
});

describe('createMatcher — wire path', () => {
  it('runs detect→embed→ann and emits on a stable auto-add', async () => {
    const { matcher, embedSpy, searchSpy } = harness({}, [
      [ann('A', 0.9), ann('B', 0.3)],
      [ann('A', 0.9), ann('B', 0.3)],
      [ann('A', 0.9), ann('B', 0.3)],
    ]);
    const sub = vi.fn();
    matcher.sink.subscribe(sub);

    await matcher.observe(event(100));
    await matcher.observe(event(200));
    await matcher.observe(event(300));

    expect(embedSpy).toHaveBeenCalledTimes(3);
    expect(searchSpy).toHaveBeenCalledTimes(3);
    expect(sub).toHaveBeenCalledTimes(1);
    const fired = sub.mock.calls[0]?.[0];
    expect(fired?.printingId).toBe('A');
    expect(fired?.disposition).toBe('auto-add');
    expect(fired?.stabilityCount).toBe(matcher.config.stabilityCount);
    expect(matcher.queue.size).toBe(1);
  });

  it('drops detection events with accepted: false at the door', async () => {
    const { matcher, embedSpy, searchSpy } = harness();
    await matcher.observe(event(100, false));
    expect(embedSpy).not.toHaveBeenCalled();
    expect(searchSpy).not.toHaveBeenCalled();
  });

  it('drops detection events with cropped: null', async () => {
    const { matcher, embedSpy } = harness();
    // accepted=true but cropped=null is a degenerate case; defensive-check still drops.
    await matcher.observe(event(100, true, null));
    expect(embedSpy).not.toHaveBeenCalled();
  });
});

describe('createMatcher — confidence gate', () => {
  it('does not emit when top-1 is below the disambig floor', async () => {
    const { matcher, searchSpy } = harness({}, [
      [ann('A', 0.3), ann('B', 0.2)],
      [ann('A', 0.3), ann('B', 0.2)],
      [ann('A', 0.3), ann('B', 0.2)],
    ]);
    const sub = vi.fn();
    matcher.sink.subscribe(sub);
    for (let i = 0; i < 3; i += 1) await matcher.observe(event(100 + i * 100));
    expect(searchSpy).toHaveBeenCalledTimes(3);
    expect(sub).not.toHaveBeenCalled();
  });

  it('demotes auto-add → disambiguate when the top gap is too small', async () => {
    const { matcher } = harness({}, [
      [ann('A', 0.82), ann('B', 0.81)],
      [ann('A', 0.82), ann('B', 0.81)],
      [ann('A', 0.82), ann('B', 0.81)],
    ]);
    const sub = vi.fn();
    matcher.sink.subscribe(sub);
    for (let i = 0; i < 3; i += 1) await matcher.observe(event(100 + i * 100));
    expect(sub).toHaveBeenCalledTimes(1);
    expect(sub.mock.calls[0]?.[0]?.disposition).toBe('disambiguate');
  });

  it('emits with the candidate list attached for the picker', async () => {
    const candidates = [ann('A', 0.9), ann('B', 0.3), ann('C', 0.2), ann('D', 0.1)];
    const { matcher } = harness({}, [candidates, candidates, candidates]);
    const sub = vi.fn();
    matcher.sink.subscribe(sub);
    for (let i = 0; i < 3; i += 1) await matcher.observe(event(100 + i * 100));
    const fired = sub.mock.calls[0]?.[0];
    expect(fired?.candidates).toHaveLength(4);
    expect(fired?.candidates[0]?.printingId).toBe('A');
  });
});

describe('createMatcher — stability gate', () => {
  it('jitter (different printings frame-to-frame) does not fire', async () => {
    const { matcher } = harness({}, [
      [ann('A', 0.9), ann('Z', 0.1)],
      [ann('B', 0.9), ann('Z', 0.1)],
      [ann('A', 0.9), ann('Z', 0.1)],
      [ann('B', 0.9), ann('Z', 0.1)],
    ]);
    const sub = vi.fn();
    matcher.sink.subscribe(sub);
    for (let i = 0; i < 4; i += 1) await matcher.observe(event(100 + i * 100));
    expect(sub).not.toHaveBeenCalled();
  });

  it('fires exactly once on hitting the stability count', async () => {
    const { matcher } = harness({}, [
      [ann('A', 0.9)],
      [ann('A', 0.9)],
      [ann('A', 0.9)],
      [ann('A', 0.9)], // 4th still on chain — should NOT re-fire (cooldown)
    ]);
    const sub = vi.fn();
    matcher.sink.subscribe(sub);
    for (let i = 0; i < 4; i += 1) await matcher.observe(event(100 + i * 100));
    expect(sub).toHaveBeenCalledTimes(1);
  });

  it('framesSinceMatch is 0 on the first fire and counts to the next fire', async () => {
    // Fire 'A' at frame 3, then 'B' at frame 5 (frames 4+5 since 'A' fired).
    const { matcher } = harness({}, [
      [ann('A', 0.9)],
      [ann('A', 0.9)],
      [ann('A', 0.9)], // fire A
      [ann('B', 0.9)],
      [ann('B', 0.9)],
      [ann('B', 0.9)], // fire B
    ]);
    const fires: { printingId: string; framesSinceMatch: number }[] = [];
    matcher.sink.subscribe((r) =>
      fires.push({ printingId: r.printingId, framesSinceMatch: r.framesSinceMatch }),
    );
    for (let i = 0; i < 6; i += 1) await matcher.observe(event(100 + i * 100));
    expect(fires).toHaveLength(2);
    expect(fires[0]?.framesSinceMatch).toBe(0);
    expect(fires[1]?.framesSinceMatch).toBe(3);
  });
});

describe('createMatcher — stack-mode cooldown', () => {
  it('refuses to re-fire the same printingId immediately after firing', async () => {
    const { matcher } = harness({}, [
      [ann('A', 0.9)],
      [ann('A', 0.9)],
      [ann('A', 0.9)], // fires
      [ann('A', 0.9)],
      [ann('A', 0.9)],
      [ann('A', 0.9)],
    ]);
    const sub = vi.fn();
    matcher.sink.subscribe(sub);
    for (let i = 0; i < 6; i += 1) await matcher.observe(event(100 + i * 100));
    expect(sub).toHaveBeenCalledTimes(1);
  });

  it('releases cooldown after a card-removed gap > stackResetMs', async () => {
    const { matcher } = harness({}, [
      [ann('A', 0.9)],
      [ann('A', 0.9)],
      [ann('A', 0.9)], // fire
      [ann('A', 0.9)], // after big gap → reset; new chain @ 1
      [ann('A', 0.9)],
      [ann('A', 0.9)], // fires again
    ]);
    const sub = vi.fn();
    matcher.sink.subscribe(sub);
    await matcher.observe(event(100));
    await matcher.observe(event(200));
    await matcher.observe(event(300));
    // Big gap > stackResetMs (350 default): card removed.
    await matcher.observe(event(2_000));
    await matcher.observe(event(2_100));
    await matcher.observe(event(2_200));
    expect(sub).toHaveBeenCalledTimes(2);
  });

  it('different printing during cooldown fires (stack flip)', async () => {
    const { matcher } = harness({}, [
      [ann('A', 0.9)],
      [ann('A', 0.9)],
      [ann('A', 0.9)], // fire A
      [ann('B', 0.9)],
      [ann('B', 0.9)],
      [ann('B', 0.9)], // fire B
    ]);
    const sub = vi.fn();
    matcher.sink.subscribe(sub);
    for (let i = 0; i < 6; i += 1) await matcher.observe(event(100 + i * 100));
    expect(sub).toHaveBeenCalledTimes(2);
    expect(sub.mock.calls[0]?.[0]?.printingId).toBe('A');
    expect(sub.mock.calls[1]?.[0]?.printingId).toBe('B');
  });

  it('queue collects sequential fires (stack-mode batch)', async () => {
    const { matcher } = harness({}, [
      [ann('A', 0.9)],
      [ann('A', 0.9)],
      [ann('A', 0.9)],
      [ann('B', 0.9)],
      [ann('B', 0.9)],
      [ann('B', 0.9)],
      [ann('C', 0.9)],
      [ann('C', 0.9)],
      [ann('C', 0.9)],
    ]);
    for (let i = 0; i < 9; i += 1) await matcher.observe(event(100 + i * 100));
    expect(matcher.queue.size).toBe(3);
    const drained = matcher.queue.flush();
    expect(drained.map((r) => r.printingId)).toEqual(['A', 'B', 'C']);
  });
});

describe('createMatcher — async debouncing', () => {
  it('keeps at most one pending event while embedCrop is in flight (newest wins)', async () => {
    // Wrapper so TS keeps the resolver typed as a callable across
    // the closure boundary (a direct `let resolveFirst: Fn | null`
    // re-narrows to `null` after the conditional assignment).
    const slot: { resolve?: (v: Float32Array) => void } = {};
    const embed = vi.fn((crop: Float32Array) => {
      if (!slot.resolve) {
        return new Promise<Float32Array>((res) => {
          slot.resolve = res;
        });
      }
      // All subsequent calls resolve synchronously.
      return Promise.resolve(new Float32Array([crop[0] ?? 0]));
    });
    let searchCalls = 0;
    const search = vi.fn((_q: Float32Array, _k: number) => {
      searchCalls += 1;
      // Reject so nothing fires — we're just counting calls.
      return [ann('Z', 0.1)];
    });
    const { matcher } = harness({ embedCrop: embed, searchKNN: search });

    const first = matcher.observe(event(100));
    // While embed #1 is pending, queue up 5 more events. Only the
    // newest should run after the first settles.
    const races = [
      matcher.observe(event(200)),
      matcher.observe(event(300)),
      matcher.observe(event(400)),
      matcher.observe(event(500)),
      matcher.observe(event(600)),
    ];
    // Allow micro-tasks to drain.
    await new Promise((r) => setTimeout(r, 0));
    expect(embed).toHaveBeenCalledTimes(1);

    // Resolve the first embed.
    slot.resolve?.(new Float32Array([1]));
    await first;
    await Promise.all(races);

    // We expect: 1st embed for ts=100, then *one* drain pass for the
    // newest pending event (ts=600). Total: 2.
    expect(embed).toHaveBeenCalledTimes(2);
    expect(searchCalls).toBe(2);
  });

  it('isMatching() flips true during embed and false after', async () => {
    const slot: { resolve?: (v: Float32Array) => void } = {};
    const embed = vi.fn(
      () =>
        new Promise<Float32Array>((res) => {
          slot.resolve = res;
        }),
    );
    const { matcher } = harness({ embedCrop: embed, searchKNN: vi.fn(() => []) });
    const obs = matcher.observe(event(100));
    await new Promise((r) => setTimeout(r, 0));
    expect(matcher.isMatching()).toBe(true);
    slot.resolve?.(new Float32Array([1, 2]));
    await obs;
    expect(matcher.isMatching()).toBe(false);
  });
});

describe('createMatcher — error tolerance', () => {
  it('survives an embedCrop throw — next event proceeds', async () => {
    let firstCall = true;
    const embed = vi.fn(async () => {
      if (firstCall) {
        firstCall = false;
        throw new Error('boom');
      }
      return new Float32Array([1]);
    });
    const { matcher } = harness(
      { embedCrop: embed },
      [
        [ann('A', 0.9)],
        [ann('A', 0.9)],
        [ann('A', 0.9)],
        [ann('A', 0.9)],
      ],
    );
    const sub = vi.fn();
    matcher.sink.subscribe(sub);
    await matcher.observe(event(100)); // throws inside embed → swallowed
    await matcher.observe(event(200));
    await matcher.observe(event(300));
    await matcher.observe(event(400));
    // First was lost; subsequent three form a stable run.
    expect(sub).toHaveBeenCalledTimes(1);
  });

  it('survives a searchKNN throw — next event proceeds', async () => {
    let firstCall = true;
    const search = vi.fn((_q: Float32Array, _k: number) => {
      if (firstCall) {
        firstCall = false;
        throw new Error('boom');
      }
      return [ann('A', 0.9)];
    });
    const { matcher } = harness({ searchKNN: search });
    const sub = vi.fn();
    matcher.sink.subscribe(sub);
    await matcher.observe(event(100)); // search throws → swallowed
    await matcher.observe(event(200));
    await matcher.observe(event(300));
    await matcher.observe(event(400));
    expect(sub).toHaveBeenCalledTimes(1);
  });
});

describe('createMatcher — disposal', () => {
  it('observes are no-ops after dispose()', async () => {
    const { matcher, embedSpy } = harness({}, [[ann('A', 0.9)]]);
    matcher.dispose();
    await matcher.observe(event(100));
    expect(embedSpy).not.toHaveBeenCalled();
  });

  it('dispose() is idempotent', () => {
    const { matcher } = harness();
    matcher.dispose();
    matcher.dispose();
    expect(matcher.isMatching()).toBe(false);
  });
});
