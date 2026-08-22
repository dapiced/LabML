/**
 * V27 — Cloudflare Pages refuses any asset over 25 MiB, and the model's
 * weights are 291 MB. So the build splits every oversized file into parts
 * under the limit, and the browser glues them back together before the
 * runtime ever sees them.
 *
 * The glue is `env.customCache`: transformers.js asks its cache for a file
 * before hitting the network, so a cache that answers "here is the whole
 * file, rebuilt from parts" needs no patching of the library at all.
 */

/** Parts stay under this; 24 MiB leaves room under the 25 MiB hard limit. */
export const SHARD_BYTES = 24 * 1024 * 1024;

export interface ShardedFile {
  /** Path inside the model directory, e.g. "onnx/model_q4f16.onnx_data". */
  path: string;
  /** Total bytes once glued — checked after reassembly, never assumed. */
  bytes: number;
  parts: { name: string; bytes: number }[];
}

export interface LlmManifest {
  /** Hugging Face repo the weights come from, pinned to one revision. */
  repo: string;
  revision: string;
  license: string;
  /** Bytes of the whole model, announced to the user BEFORE any download. */
  totalBytes: number;
  files: ShardedFile[];
}

export interface DownloadProgress {
  /** Bytes fetched so far across every file. */
  loaded: number;
  total: number;
}

function suffixMatch(url: string, path: string): boolean {
  const normalized = url.split('?')[0];
  return normalized.endsWith(`/${path}`);
}

/**
 * Fetches every part of one file in order and glues them into a single
 * buffer. Anything unexpected — a missing part, a short read, a total that
 * does not match the manifest — throws a NAMED error: a half-rebuilt model
 * would fail much later, in a way nobody could diagnose.
 */
export async function assembleFile(
  baseUrl: string,
  file: ShardedFile,
  onChunk?: (bytes: number) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const out = new Uint8Array(file.bytes);
  let offset = 0;
  for (const part of file.parts) {
    const response = await fetch(`${baseUrl}${part.name}`, signal ? { signal } : undefined);
    if (!response.ok) throw new Error(`llm-part-missing:${part.name}:${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== part.bytes) {
      throw new Error(`llm-part-size:${part.name}:${bytes.byteLength}:${part.bytes}`);
    }
    if (offset + bytes.byteLength > out.byteLength) {
      throw new Error(`llm-overflow:${file.path}`);
    }
    out.set(bytes, offset);
    offset += bytes.byteLength;
    onChunk?.(bytes.byteLength);
  }
  if (offset !== file.bytes) throw new Error(`llm-short:${file.path}:${offset}:${file.bytes}`);
  return out;
}

/**
 * A Web-Cache-shaped object for `env.customCache`. `match` rebuilds sharded
 * files from their parts; anything not in the manifest is left to the normal
 * fetch path (small files are served whole). `put` is a no-op: the assembled
 * buffer is hundreds of megabytes and storing it a second time would double
 * the footprint for nothing — the browser's HTTP cache already keeps the
 * parts, which is what makes the second visit fast.
 */
export function createShardCache(
  manifest: LlmManifest,
  baseUrl: string,
  onProgress?: (progress: DownloadProgress) => void,
  signal?: AbortSignal,
) {
  const total = manifest.totalBytes;
  let loaded = 0;
  return {
    async match(request: Request | string): Promise<Response | undefined> {
      const url = typeof request === 'string' ? request : request.url;
      const file = manifest.files.find((f) => suffixMatch(url, f.path));
      if (!file) return undefined;
      const bytes = await assembleFile(
        baseUrl,
        file,
        (chunk) => {
          loaded += chunk;
          onProgress?.({ loaded, total });
        },
        signal,
      );
      // A fresh ArrayBuffer view: Response takes ownership of the bytes.
      return new Response(bytes as unknown as BodyInit, {
        headers: { 'content-type': 'application/octet-stream' },
      });
    },
    async put(): Promise<void> {
      // Deliberately nothing — see the note above.
    },
  };
}

/**
 * Human-readable size for the consent screen. Decimal MB on purpose: that is
 * what the browser's own download indicator will show, and announcing 353
 * while the browser counts 370 would be a small lie in a wave built on not
 * telling them.
 */
export function formatBytes(bytes: number, lang: string): string {
  const mb = bytes / 1e6;
  if (mb >= 1000) {
    return `${(mb / 1000).toLocaleString(lang, { maximumFractionDigits: 2 })} GB`;
  }
  return `${mb.toLocaleString(lang, { maximumFractionDigits: 0 })} MB`;
}
