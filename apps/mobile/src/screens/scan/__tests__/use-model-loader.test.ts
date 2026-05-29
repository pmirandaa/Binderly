// `useModelLoader` — warm-cache behaviour (FU-35) plus the legacy
// per-mount load/dispose path.

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resetModelWarmCache } from '../../../scanner/model-cache.js';
import { useModelLoader, type ModelHandles } from '../use-model-loader.js';

function makeHandles(): ModelHandles {
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

describe('useModelLoader — legacy per-mount path (no warm key)', () => {
  it('loads on mount and disposes handles on unmount', async () => {
    const handles = makeHandles();
    const loadModels = vi.fn(async () => handles);

    const { result, unmount } = renderHook(() => useModelLoader({ loadModels }));

    await waitFor(() => expect(result.current.loadState.phase).toBe('ready'));
    expect(loadModels).toHaveBeenCalledTimes(1);

    unmount();
    expect(handles.embedModel.dispose).toHaveBeenCalledTimes(1);
    expect(handles.annIndex.dispose).toHaveBeenCalledTimes(1);
  });

  it('reloads on a fresh mount (cold every time)', async () => {
    const loadModels = vi.fn(async () => makeHandles());

    const first = renderHook(() => useModelLoader({ loadModels }));
    await waitFor(() => expect(first.result.current.loadState.phase).toBe('ready'));
    first.unmount();

    const second = renderHook(() => useModelLoader({ loadModels }));
    await waitFor(() => expect(second.result.current.loadState.phase).toBe('ready'));

    expect(loadModels).toHaveBeenCalledTimes(2);
  });
});

describe('useModelLoader — warm cache (FU-35)', () => {
  const WARM_KEY = 'test:warm';

  it('warm-hit avoids a reload across remounts and keeps handles alive', async () => {
    const handles = makeHandles();
    const loadModels = vi.fn(async () => handles);

    const first = renderHook(() =>
      useModelLoader({ loadModels, warmCacheKey: WARM_KEY }),
    );
    await waitFor(() => expect(first.result.current.loadState.phase).toBe('ready'));
    first.unmount();

    // Warm-cached handles must NOT be disposed on unmount.
    expect(handles.embedModel.dispose).not.toHaveBeenCalled();
    expect(handles.annIndex.dispose).not.toHaveBeenCalled();

    const second = renderHook(() =>
      useModelLoader({ loadModels, warmCacheKey: WARM_KEY }),
    );
    await waitFor(() => expect(second.result.current.loadState.phase).toBe('ready'));

    // Cold-miss loaded once; warm-hit reused — loader still called once.
    expect(loadModels).toHaveBeenCalledTimes(1);
    expect(second.result.current.handles).toBe(handles);
    second.unmount();
  });

  it('reset clears the warm cache so the next mount reloads (cold miss)', async () => {
    const loadModels = vi.fn(async () => makeHandles());

    const first = renderHook(() =>
      useModelLoader({ loadModels, warmCacheKey: WARM_KEY }),
    );
    await waitFor(() => expect(first.result.current.loadState.phase).toBe('ready'));
    first.unmount();
    expect(loadModels).toHaveBeenCalledTimes(1);

    resetModelWarmCache();

    const second = renderHook(() =>
      useModelLoader({ loadModels, warmCacheKey: WARM_KEY }),
    );
    await waitFor(() => expect(second.result.current.loadState.phase).toBe('ready'));
    expect(loadModels).toHaveBeenCalledTimes(2);
    second.unmount();
  });

  it('surfaces an error and does not poison the cache', async () => {
    const loadModels = vi
      .fn<() => Promise<ModelHandles>>()
      .mockRejectedValueOnce(new Error('gpu init failed'))
      .mockResolvedValueOnce(makeHandles());

    const first = renderHook(() =>
      useModelLoader({ loadModels, warmCacheKey: WARM_KEY }),
    );
    await waitFor(() => expect(first.result.current.loadState.phase).toBe('error'));
    expect(first.result.current.loadState.error?.message).toBe('gpu init failed');
    first.unmount();

    // The failed load wasn't cached, so a fresh mount re-attempts.
    const second = renderHook(() =>
      useModelLoader({ loadModels, warmCacheKey: WARM_KEY }),
    );
    await waitFor(() => expect(second.result.current.loadState.phase).toBe('ready'));
    expect(loadModels).toHaveBeenCalledTimes(2);
    second.unmount();
  });
});
