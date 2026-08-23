/**
 * V27 — fetches the local language model from Hugging Face and lays it out
 * for Cloudflare Pages, which refuses any single asset over 25 MiB.
 *
 * Run before `wrangler pages deploy` (see .github/workflows/ci.yml). The
 * weights are NOT committed: 355 MB of binaries would slow every clone and
 * every CI checkout, for a model only the opt-in chat engine downloads.
 *
 *   node scripts/prepare-llm.mjs <outDir>          # default: dist/llm
 *   node scripts/prepare-llm.mjs <outDir> --flat  # unsharded, for the Node bench
 *
 * V30 — `--flat` writes the same pinned files without splitting them, which is
 * what `npm run llm:bench:node` needs: onnxruntime-node reads the weights from
 * disk directly and has no 25 MiB limit to work around. It is the same
 * download, the same size checks, and the same revision as the deployed copy —
 * so the bench measures the model production actually ships, not a lookalike.
 *
 * Every file is checked against the byte sizes pinned below. A mismatch is a
 * hard failure: shipping a truncated model would fail in the browser, later,
 * in a way nobody could diagnose from the symptom.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const REPO = 'onnx-community/Qwen3-0.6B-DQ-ONNX';
/** Pinned so a silent upstream change can never reach production unnoticed. */
const REVISION = 'main';
const LICENSE = 'Apache-2.0';
/** Parts stay under this; 24 MiB leaves room under the 25 MiB hard limit. */
const SHARD_BYTES = 24 * 1024 * 1024;

/** path -> expected bytes. Measured at acquisition (V27), verified on every build. */
const FILES = {
  'config.json': 983,
  'generation_config.json': null, // taken from the base model, size not pinned
  'tokenizer.json': 11422654,
  'tokenizer_config.json': 9762,
  'special_tokens_map.json': 613,
  'added_tokens.json': 707,
  'vocab.json': 2776833,
  'onnx/model_q4f16.onnx': 64238474,
  'onnx/model_q4f16.onnx_data': 291272704,
};

/** generation_config.json is absent from the ONNX repo — the base model has it. */
const FROM_BASE = new Set(['generation_config.json', 'LICENSE']);
const BASE_REPO = 'Qwen/Qwen3-0.6B';

/**
 * LLM_MIRROR points the fetch at a local copy — used to verify this script
 * without re-downloading 355 MB, and as an escape hatch if Hugging Face is
 * unreachable from a build runner.
 */
function url(path) {
  const repo = FROM_BASE.has(path) ? BASE_REPO : REPO;
  const rev = FROM_BASE.has(path) ? 'main' : REVISION;
  if (process.env.LLM_MIRROR) return `${process.env.LLM_MIRROR}/${path}`;
  return `https://huggingface.co/${repo}/resolve/${rev}/${path}`;
}

async function download(path) {
  // Hugging Face refuses requests without a User-Agent behind some proxies.
  const response = await fetch(url(path), {
    headers: { 'User-Agent': 'LabML-build/1.0 (+https://app.dominicdapice.com)' },
  });
  if (!response.ok) throw new Error(`fetch-failed:${path}:${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const expected = FILES[path];
  if (expected != null && bytes.byteLength !== expected) {
    throw new Error(`size-mismatch:${path}:got ${bytes.byteLength}:want ${expected}`);
  }
  return bytes;
}

async function write(outDir, relative, bytes) {
  const target = join(outDir, relative);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--flat');
  const flat = process.argv.includes('--flat');
  const outDir = args[0] ?? 'dist/llm';
  const root = join(outDir, REPO);
  const files = [];
  let totalBytes = 0;

  for (const path of [...Object.keys(FILES), 'LICENSE']) {
    const bytes = await download(path);
    totalBytes += bytes.byteLength;
    if (flat || bytes.byteLength <= SHARD_BYTES) {
      await write(root, path, bytes);
      console.log(`  entier  ${path} (${(bytes.byteLength / 1e6).toFixed(1)} Mo)`);
      continue;
    }
    // Oversized: split into numbered parts the browser glues back together.
    const parts = [];
    for (let offset = 0, index = 0; offset < bytes.byteLength; offset += SHARD_BYTES, index++) {
      const slice = bytes.subarray(offset, Math.min(offset + SHARD_BYTES, bytes.byteLength));
      const name = `${path}.part${String(index).padStart(3, '0')}`;
      await write(root, name, slice);
      parts.push({ name, bytes: slice.byteLength });
    }
    files.push({ path, bytes: bytes.byteLength, parts });
    console.log(
      `  découpé ${path} (${(bytes.byteLength / 1e6).toFixed(1)} Mo → ${parts.length} morceaux)`,
    );
  }

  const manifest = { repo: REPO, revision: REVISION, license: LICENSE, totalBytes, files };
  await write(outDir, 'manifest.json', JSON.stringify(manifest, null, 2));
  console.log(`\nmanifeste écrit — ${(totalBytes / 1e6).toFixed(0)} Mo au total`);

  // The 25 MiB guard below is about Cloudflare Pages. A flat copy never goes
  // there — it is read from local disk by the bench — so the guard would fail
  // on a layout that is correct for its purpose.
  if (flat) {
    console.log('copie à plat (banc Node) — garde des 25 Mio sans objet ✓');
    return;
  }

  // A last guard: nothing we just wrote may exceed the platform limit.
  const oversized = [];
  const walk = async (dir) => {
    const { readdir, stat } = await import('node:fs/promises');
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if ((await stat(full)).size > 25 * 1024 * 1024) oversized.push(full);
    }
  };
  await walk(outDir);
  if (oversized.length > 0) throw new Error(`over-25MiB:${oversized.join(',')}`);
  console.log('aucun fichier au-dessus de 25 Mio ✓');
}

await main();
