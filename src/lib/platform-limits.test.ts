/**
 * V35 — Cloudflare Pages refuses any single asset over 25 MiB, and LabML
 * self-hosts several binaries that sit close to it.
 *
 * This limit had already bitten twice. DuckDB-Wasm is pinned to 1.28.0 because
 * from 1.29 its binaries jumped to 34.2 and 39.4 MiB (see `vite.config.ts`),
 * and the language model is sharded into 24 MiB parts for the same reason —
 * `shards.test.ts` guards that one. What nothing guarded was the runtime
 * binaries themselves: the audit measured `ort-wasm-simd-threaded.jsep.wasm`
 * at 26 101 073 bytes, which clears the limit by 0.11 MiB. `vite.config.ts`
 * even says so in a comment — « check on upgrades » — but a comment is not a
 * check. A minor bump of onnxruntime-web would break the deploy, and the first
 * anyone would know is a failed `wrangler pages deploy`.
 *
 * So this reads the files Vite is configured to copy, from `node_modules`
 * rather than from `dist/`: unit tests run before the build in CI, so the
 * built output does not exist yet, and the copied source is the real input.
 */
import { readdirSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Cloudflare Pages' hard per-file ceiling. */
const LIMIT = 25 * 1024 * 1024;

const ORT = 'node_modules/onnxruntime-web/dist';
const ORT_LLM = 'node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist';
const DUCKDB = 'node_modules/@duckdb/duckdb-wasm/dist';

/**
 * Exactly what `viteStaticCopy` is told to copy in `vite.config.ts`. Kept as
 * explicit names rather than a glob of the whole package: a new file appearing
 * in a dependency is not something this test should silently start guarding,
 * and a file disappearing from it *is* something it should notice.
 */
const COPIED = [
  `${ORT}/ort-wasm-simd-threaded.wasm`,
  `${ORT_LLM}/ort-wasm-simd-threaded.wasm`,
  `${ORT_LLM}/ort-wasm-simd-threaded.jsep.wasm`,
  `${ORT_LLM}/ort-wasm-simd-threaded.asyncify.wasm`,
  `${DUCKDB}/duckdb-eh.wasm`,
  `${DUCKDB}/duckdb-mvp.wasm`,
];

const mib = (bytes: number) => (bytes / 1024 / 1024).toFixed(2);

describe('every self-hosted binary clears Cloudflare’s 25 MiB per-file limit', () => {
  it.each(COPIED)('%s', (path) => {
    const { size } = statSync(path);
    expect(
      size,
      `${path} is ${mib(size)} MiB — ${mib(size - LIMIT)} MiB OVER the ${mib(LIMIT)} MiB limit. ` +
        `Cloudflare Pages will refuse the deploy. Pin the dependency back, or split the file.`,
    ).toBeLessThanOrEqual(LIMIT);
  });

  it('reports how much room is left, so a thin margin is visible before it is a failure', () => {
    const margins = COPIED.map((path) => ({ path, left: LIMIT - statSync(path).size })).sort(
      (a, b) => a.left - b.left,
    );
    const tightest = margins[0];
    // Not an assertion on the value — the margin is what it is, and pinning a
    // number here would fail on every legitimate patch release. The assertion
    // is that a margin exists at all; the message carries the figure into the
    // test output, where an upgrade will show it shrinking.
    expect(
      tightest.left,
      `tightest: ${tightest.path} has ${mib(tightest.left)} MiB left under the limit`,
    ).toBeGreaterThan(0);
  });

  it('guards the vision models shipped from the repository too', () => {
    for (const file of readdirSync('public/models')) {
      const path = `public/models/${file}`;
      const { size } = statSync(path);
      expect(size, `${path} is ${mib(size)} MiB`).toBeLessThanOrEqual(LIMIT);
    }
  });
});
