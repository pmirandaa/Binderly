// Module-level model warm cache (FU-35).
//
// Covers: cold-miss loads once, warm-hit avoids reload, concurrent
// callers share one load, failures aren't cached (so retry can
// re-attempt), and reset clears (optionally disposing handles).

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getOrLoadWarmModels,
  isModelWarm,
  modelWarmCacheSize,
  resetModelWarmCache,
  type WarmModelHandles,
} from '../model-cache.js';

function makeHandles(): WarmModelHandles {
  return {
    embedModel: {
      embeddingDim: 128,
      delegate: 'cpu',
      isUsingGpu: false,
      modelName: 'stub',
      modelVersion: '0.0.0',
      embed: async () => new Float32Array(128),
      dispose: vi.fn(),
    },
    annIndex: {
      dim: 128,
      count: 0,
      format: 'flat',
      metric: 'cosine',
      dtype: 'float32',
      name: 'stub',
      version: '0.0.0',
      embeddingModelName: 'stub',
      embeddingModelVersion: '0.0.0',
      embeddingModelHash: '',
      searchKNN: () => [],
      dispose: vi.fn(),
    },
  };
}

afterEach(() => {
  resetModelWarmCache();
});

describe('model warm cache', () => {
  it('loads once on a cold miss and reports warm afterwards', async () => {
    const load = vi.fn(async () => makeHandles());
    expect(isModelWarm('k')).toBe(false);

    const handles = await getOrLoadWarmModels('k', load);

    expect(load).toHaveBeenCalledTimes(1);
    expect(handles.embedModel.modelName).toBe('stub');
    expect(isModelWarm('k')).toBe(true);
    expect(modelWarmCacheSize()).toBe(1);
  });

  it('returns the cached handles on a warm hit without reloading', async () => {
    const load = vi.fn(async () => makeHandles());

    const first = await getOrLoadWarmModels('k', load);
    const second = await getOrLoadWarmModels('k', load);

    expect(load).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('shares a single in-flight load across concurrent callers', async () => {
    const load = vi.fn(async () => makeHandles());

    const [a, b] = await Promise.all([
      getOrLoadWarmModels('k', load),
      getOrLoadWarmModels('k', load),
    ]);

    expect(load).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it('keys distinct assets separately', async () => {
    await getOrLoadWarmModels('a', async () => makeHandles());
    await getOrLoadWarmModels('b', async () => makeHandles());
    expect(modelWarmCacheSize()).toBe(2);
  });

  it('does not cache a failed load so a retry can re-attempt', async () => {
    const load = vi
      .fn<() => Promise<WarmModelHandles>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(makeHandles());

    await expect(getOrLoadWarmModels('k', load)).rejects.toThrow('boom');
    expect(isModelWarm('k')).toBe(false);

    const handles = await getOrLoadWarmModels('k', load);
    expect(handles.embedModel.modelName).toBe('stub');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('reset clears every entry (cold again)', async () => {
    await getOrLoadWarmModels('k', async () => makeHandles());
    expect(isModelWarm('k')).toBe(true);

    resetModelWarmCache();

    expect(isModelWarm('k')).toBe(false);
    expect(modelWarmCacheSize()).toBe(0);
  });

  it('optionally disposes handles on reset', async () => {
    const handles = makeHandles();
    await getOrLoadWarmModels('k', async () => handles);

    resetModelWarmCache({ dispose: true });
    // Disposal happens after the cached promise resolves.
    await Promise.resolve();
    await Promise.resolve();

    expect(handles.embedModel.dispose).toHaveBeenCalledTimes(1);
    expect(handles.annIndex.dispose).toHaveBeenCalledTimes(1);
  });
});
