// Tests for `loadEmbeddingModel`. We mock the `./native` indirection
// so the test runner doesn't need the real native binding installed —
// the mock satisfies the structural `LoadedTensorflowModel` contract.

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

// ----- mock the native indirection ------------------------------------
// `vi.mock` is hoisted by the vitest transformer, so the surrounding
// `import` order is what eslint's import/order rule sees.
vi.mock('../native', () => ({
  loadTensorflowModel: vi.fn(),
}));

import {
  EmbeddingLoadError,
  loadEmbeddingModel,
  type LoadEmbeddingModelOptions,
} from '../loader';
import { loadTensorflowModel } from '../native';
import { createEmbedTelemetry } from '../telemetry';

import type { EmbedFrameInput } from '../types';

const mockedLoad = loadTensorflowModel as unknown as Mock;

// ----- helpers --------------------------------------------------------

interface FakeModelOptions {
  embeddingDim: number;
  /** Bytes returned per run; defaults to a deterministic ramp. */
  outputFactory?: (call: number) => ArrayBuffer;
}

function fakeModel(opts: FakeModelOptions) {
  let call = 0;
  return {
    run: vi.fn(async () => {
      const buf = opts.outputFactory
        ? opts.outputFactory(call)
        : (() => {
            const v = new Float32Array(opts.embeddingDim);
            for (let i = 0; i < v.length; i += 1) v[i] = i + 1;
            call += 1;
            return v.buffer;
          })();
      return [buf];
    }),
    inputs: [
      {
        name: 'image',
        shape: [1, 224, 224, 3],
        dataType: 'float32',
      },
    ],
    outputs: [
      {
        name: 'embedding',
        shape: [1, opts.embeddingDim],
        dataType: 'float32',
      },
    ],
  };
}

function whiteFrame(width = 16, height = 16): EmbedFrameInput {
  const bytes = new Uint8Array(width * height * 3).fill(255);
  return {
    width,
    height,
    toArrayBuffer: () => bytes.buffer.slice(0) as ArrayBuffer,
  };
}

const TINY_FIXTURE_MANIFEST = {
  name: 'tiny-embedder',
  version: '1.0.0-fixture',
  modelHash: 'ae821f7a9d48341e52bbb22401f882f8fbf647e294b64fd97db44b4e4105cb2a',
  inputShape: [1, 224, 224, 3],
  embeddingDim: 32,
  normalization: 'zero_one',
  createdAt: '2026-05-20T00:00:00.000Z',
  sourceUrl: null,
};

function options(
  overrides: Partial<LoadEmbeddingModelOptions> = {},
): LoadEmbeddingModelOptions {
  return {
    modelSource: 'asset://fixture.tflite',
    manifest: TINY_FIXTURE_MANIFEST,
    ...overrides,
  };
}

beforeEach(() => {
  mockedLoad.mockReset();
});

// ----- manifest validation -------------------------------------------
describe('loadEmbeddingModel — manifest validation', () => {
  it('rejects a manifest with the wrong shape', async () => {
    await expect(
      loadEmbeddingModel(options({ manifest: { bad: 'manifest' } })),
    ).rejects.toMatchObject({
      name: 'EmbeddingLoadError',
      code: 'MANIFEST_INVALID',
    });
    expect(mockedLoad).not.toHaveBeenCalled();
  });

  it('rejects a manifest JSON string that does not parse', async () => {
    await expect(
      loadEmbeddingModel(options({ manifest: '{not-json' })),
    ).rejects.toBeInstanceOf(EmbeddingLoadError);
  });

  it('accepts a manifest passed as JSON string', async () => {
    mockedLoad.mockResolvedValue(fakeModel({ embeddingDim: 32 }));
    const handle = await loadEmbeddingModel(
      options({ manifest: JSON.stringify(TINY_FIXTURE_MANIFEST) }),
    );
    expect(handle.embeddingDim).toBe(32);
  });
});

// ----- GPU → CPU fallback --------------------------------------------
describe('loadEmbeddingModel — delegate fallback', () => {
  it('uses GPU when the first delegate succeeds', async () => {
    mockedLoad.mockResolvedValueOnce(fakeModel({ embeddingDim: 32 }));
    const handle = await loadEmbeddingModel(options());
    expect(handle.delegate).toBe('gpu');
    expect(handle.isUsingGpu).toBe(true);
    expect(mockedLoad).toHaveBeenCalledTimes(1);
    expect(mockedLoad).toHaveBeenCalledWith(
      expect.anything(),
      ['core-ml'],
    );
  });

  it('falls back to android-gpu if core-ml init fails', async () => {
    mockedLoad
      .mockRejectedValueOnce(new Error('no coreml on android'))
      .mockResolvedValueOnce(fakeModel({ embeddingDim: 32 }));
    const handle = await loadEmbeddingModel(options());
    expect(handle.delegate).toBe('gpu');
    expect(mockedLoad).toHaveBeenNthCalledWith(2, expect.anything(), [
      'android-gpu',
    ]);
  });

  it('falls back to CPU when both GPU delegates throw', async () => {
    mockedLoad
      .mockRejectedValueOnce(new Error('no coreml'))
      .mockRejectedValueOnce(new Error('no android-gpu'))
      .mockResolvedValueOnce(fakeModel({ embeddingDim: 32 }));
    const handle = await loadEmbeddingModel(options());
    expect(handle.delegate).toBe('cpu');
    expect(handle.isUsingGpu).toBe(false);
    expect(mockedLoad).toHaveBeenCalledTimes(3);
    expect(mockedLoad).toHaveBeenLastCalledWith(expect.anything(), []);
  });

  it('honors `delegatePreference: cpu` and skips the GPU path entirely', async () => {
    mockedLoad.mockResolvedValueOnce(fakeModel({ embeddingDim: 32 }));
    const handle = await loadEmbeddingModel(
      options({ delegatePreference: 'cpu' }),
    );
    expect(handle.delegate).toBe('cpu');
    expect(mockedLoad).toHaveBeenCalledTimes(1);
    expect(mockedLoad).toHaveBeenCalledWith(expect.anything(), []);
  });

  it('wraps a CPU-failure in EmbeddingLoadError when every delegate fails', async () => {
    mockedLoad
      .mockRejectedValueOnce(new Error('a'))
      .mockRejectedValueOnce(new Error('b'))
      .mockRejectedValueOnce(new Error('c'));
    await expect(loadEmbeddingModel(options())).rejects.toMatchObject({
      code: 'MODEL_LOAD_FAILED',
    });
  });
});

// ----- output-shape cross-check --------------------------------------
describe('loadEmbeddingModel — output validation', () => {
  it('rejects a model whose output dim disagrees with the manifest', async () => {
    mockedLoad.mockResolvedValueOnce(fakeModel({ embeddingDim: 64 }));
    await expect(
      loadEmbeddingModel(
        options({ manifest: { ...TINY_FIXTURE_MANIFEST, embeddingDim: 32 } }),
      ),
    ).rejects.toMatchObject({ code: 'OUTPUT_DIM_MISMATCH' });
  });

  it('rejects a model that exposes no output tensors', async () => {
    mockedLoad.mockResolvedValueOnce({
      run: vi.fn(),
      inputs: [],
      outputs: [],
    });
    await expect(loadEmbeddingModel(options())).rejects.toMatchObject({
      code: 'OUTPUT_TENSOR_MISSING',
    });
  });

  it('accepts unbatched output shape ([D] instead of [1, D])', async () => {
    mockedLoad.mockResolvedValueOnce({
      ...fakeModel({ embeddingDim: 32 }),
      outputs: [
        {
          name: 'embedding',
          shape: [32], // no leading 1
          dataType: 'float32',
        },
      ],
    });
    const handle = await loadEmbeddingModel(options());
    expect(handle.embeddingDim).toBe(32);
  });
});

// ----- inference contract --------------------------------------------
describe('loadEmbeddingModel — inference', () => {
  it('embed() returns an L2-normalised Float32Array of embeddingDim', async () => {
    mockedLoad.mockResolvedValueOnce(fakeModel({ embeddingDim: 32 }));
    const handle = await loadEmbeddingModel(options());
    const vec = await handle.embed(whiteFrame());
    expect(vec).toBeInstanceOf(Float32Array);
    expect(vec.length).toBe(32);
    let sum = 0;
    for (let i = 0; i < vec.length; i += 1) {
      const v = vec[i] ?? 0;
      sum += v * v;
    }
    expect(Math.sqrt(sum)).toBeCloseTo(1.0, 5);
  });

  it('embed() fires a telemetry event with delegate + duration', async () => {
    mockedLoad.mockResolvedValueOnce(fakeModel({ embeddingDim: 32 }));
    const bus = createEmbedTelemetry();
    const listener = vi.fn();
    bus.on(listener);
    const handle = await loadEmbeddingModel(options({ telemetry: bus }));
    await handle.embed(whiteFrame(32, 24));
    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]?.[0];
    expect(event).toBeDefined();
    expect(event?.delegate).toBe('gpu');
    expect(event?.framePixels).toBe(32 * 24);
    expect(event?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('embed() rejects when the model returns no output tensor', async () => {
    const model = fakeModel({ embeddingDim: 32 });
    model.run = vi.fn(async () => []);
    mockedLoad.mockResolvedValueOnce(model);
    const handle = await loadEmbeddingModel(options());
    await expect(handle.embed(whiteFrame())).rejects.toMatchObject({
      code: 'OUTPUT_TENSOR_MISSING',
    });
  });

  it('embed() throws after dispose()', async () => {
    mockedLoad.mockResolvedValueOnce(fakeModel({ embeddingDim: 32 }));
    const handle = await loadEmbeddingModel(options());
    handle.dispose();
    await expect(handle.embed(whiteFrame())).rejects.toThrow(/disposed/);
  });

  it('dispose() is idempotent', async () => {
    mockedLoad.mockResolvedValueOnce(fakeModel({ embeddingDim: 32 }));
    const handle = await loadEmbeddingModel(options());
    expect(() => {
      handle.dispose();
      handle.dispose();
    }).not.toThrow();
  });

  it('handle exposes model identity from the manifest', async () => {
    mockedLoad.mockResolvedValueOnce(fakeModel({ embeddingDim: 32 }));
    const handle = await loadEmbeddingModel(options());
    expect(handle.modelName).toBe('tiny-embedder');
    expect(handle.modelVersion).toBe('1.0.0-fixture');
  });
});
