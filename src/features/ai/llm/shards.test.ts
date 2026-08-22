import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assembleFile,
  createShardCache,
  formatBytes,
  SHARD_BYTES,
  type LlmManifest,
} from '@/features/ai/llm/shards';

const FILE = {
  path: 'onnx/model.onnx_data',
  bytes: 10,
  parts: [
    { name: 'onnx/model.onnx_data.part000', bytes: 4 },
    { name: 'onnx/model.onnx_data.part001', bytes: 4 },
    { name: 'onnx/model.onnx_data.part002', bytes: 2 },
  ],
};

const MANIFEST: LlmManifest = {
  repo: 'org/model',
  revision: 'main',
  license: 'Apache-2.0',
  totalBytes: 10,
  files: [FILE],
};

/** Serves parts 0,1,2 as [0,1,2,3] [4,5,6,7] [8,9] unless told otherwise. */
function serve(overrides: Record<string, Response | undefined> = {}) {
  return vi.fn(async (url: string) => {
    if (url in overrides) {
      const response = overrides[url];
      if (!response) throw new Error('unexpected');
      return response;
    }
    const index = Number(url.slice(-1));
    const start = index * 4;
    const length = index === 2 ? 2 : 4;
    return new Response(new Uint8Array(Array.from({ length }, (_, i) => start + i)));
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SHARD_BYTES', () => {
  it('stays under the 25 MiB platform limit, with room to spare', () => {
    expect(SHARD_BYTES).toBeLessThan(25 * 1024 * 1024);
  });
});

describe('assembleFile', () => {
  it('glues the parts back in order, byte for byte', async () => {
    vi.stubGlobal('fetch', serve());
    const bytes = await assembleFile('/llm/org/model/', FILE);
    expect([...bytes]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('reports progress per part, summing to the whole file', async () => {
    vi.stubGlobal('fetch', serve());
    const chunks: number[] = [];
    await assembleFile('/llm/org/model/', FILE, (n) => chunks.push(n));
    expect(chunks).toEqual([4, 4, 2]);
  });

  it('refuses BY NAME when a part is missing — never a half-built model', async () => {
    vi.stubGlobal(
      'fetch',
      serve({ '/llm/org/model/onnx/model.onnx_data.part001': new Response('', { status: 404 }) }),
    );
    await expect(assembleFile('/llm/org/model/', FILE)).rejects.toThrow(
      'llm-part-missing:onnx/model.onnx_data.part001:404',
    );
  });

  it('refuses BY NAME when a part is the wrong size', async () => {
    vi.stubGlobal(
      'fetch',
      serve({
        '/llm/org/model/onnx/model.onnx_data.part002': new Response(
          new Uint8Array([1, 2, 3, 4, 5]),
        ),
      }),
    );
    await expect(assembleFile('/llm/org/model/', FILE)).rejects.toThrow(/^llm-/);
  });
});

describe('createShardCache', () => {
  it('answers with the whole file for a sharded path', async () => {
    vi.stubGlobal('fetch', serve());
    const cache = createShardCache(MANIFEST, '/llm/org/model/');
    const hit = await cache.match('https://app.example/llm/org/model/onnx/model.onnx_data');
    expect(hit).toBeInstanceOf(Response);
    expect([...new Uint8Array(await hit!.arrayBuffer())]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('ignores query strings when matching the path', async () => {
    vi.stubGlobal('fetch', serve());
    const cache = createShardCache(MANIFEST, '/llm/org/model/');
    expect(await cache.match('/llm/org/model/onnx/model.onnx_data?v=2')).toBeInstanceOf(Response);
  });

  it('stands aside for files it does not shard, so they fetch normally', async () => {
    vi.stubGlobal('fetch', serve());
    const cache = createShardCache(MANIFEST, '/llm/org/model/');
    expect(await cache.match('/llm/org/model/tokenizer.json')).toBeUndefined();
  });

  it('reports cumulative progress against the announced total', async () => {
    vi.stubGlobal('fetch', serve());
    const seen: { loaded: number; total: number }[] = [];
    const cache = createShardCache(MANIFEST, '/llm/org/model/', (p) => seen.push({ ...p }));
    await cache.match('/llm/org/model/onnx/model.onnx_data');
    expect(seen).toEqual([
      { loaded: 4, total: 10 },
      { loaded: 8, total: 10 },
      { loaded: 10, total: 10 },
    ]);
  });
});

describe('formatBytes', () => {
  it('states the size the way a consent screen must', () => {
    expect(formatBytes(355 * 1024 * 1024, 'en')).toBe('355 MB');
    expect(formatBytes(2 * 1024 * 1024 * 1024, 'en')).toBe('2 GB');
  });
});
