/// <reference types="vitest/config" />
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { viteStaticCopy } from 'vite-plugin-static-copy';

/**
 * A prerendered route: its static shell (index.html + the page hero injected
 * into #root) paints as soon as the CSS arrives, and React simply replaces it
 * on mount — same markup, no hydration involved. `facade` is the route's lazy
 * chunk, modulepreloaded from the shell so it downloads with the entry.
 */
interface ShellRoute {
  dir: string;
  /** Key prefix into en.json (dot path) holding eyebrow/lede + title keys. */
  prefix: string;
  /** Pages titled titlePre + highlighted span; the rest use a plain `title`. */
  highlight?: boolean;
  facade: string;
}

const SHELL_ROUTES: ShellRoute[] = [
  { dir: 'ml', prefix: 'ml', highlight: true, facade: 'features/ml/pages/MlHomePage' },
  { dir: 'data', prefix: 'data', facade: 'features/data/DataPage' },
  { dir: 'ai', prefix: 'ai', facade: 'features/ai/AiPage' },
  { dir: 'ai/vision', prefix: 'ai.vision', facade: 'features/ai/vision/VisionPage' },
  { dir: 'ai/chat', prefix: 'ai.chat', facade: 'features/ai/chat/ChatPage' },
  { dir: 'about', prefix: 'about', facade: 'features/about/AboutPage' },
  { dir: 'privacy', prefix: 'privacy', facade: 'features/privacy/PrivacyPage' },
];

/**
 * Lazy routes normally load in a second network phase after the entry has
 * executed. Injecting modulepreload hints for the main routes' chunk graphs
 * lets the browser fetch them in parallel with the entry — the waterfall
 * collapses without giving up code splitting. The root index.html (also the
 * SPA fallback) keeps the home + /ml facades; every prerendered shell carries
 * its own facade instead. Dynamic routes (/ml/run/:id, /ml/share) stay on the
 * fallback — a shell would show the wrong content there.
 */
function prerenderShells(rootTargets: string[]): Plugin {
  let outDir = 'dist';
  const facadeFiles = new Map<string, string>();
  return {
    name: 'labml-prerender-shells',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    generateBundle(_, bundle) {
      // Facade chunks only: preloading their whole import graphs competes
      // with the entry for bandwidth and makes first paint WORSE (measured).
      const wanted = [...rootTargets, ...SHELL_ROUTES.map((route) => route.facade)];
      for (const entry of Object.values(bundle)) {
        if (entry.type !== 'chunk' || entry.facadeModuleId === null) continue;
        const target = wanted.find((t) => entry.facadeModuleId!.includes(t));
        if (target) facadeFiles.set(target, entry.fileName);
      }
    },
    closeBundle() {
      const preload = (target: string) => {
        const file = facadeFiles.get(target);
        return file ? `    <link rel="modulepreload" crossorigin href="/${file}">\n` : '';
      };
      const htmlPath = join(outDir, 'index.html');
      let base = readFileSync(htmlPath, 'utf8');

      // Inline the (single, ~9 KB gzipped) stylesheet: the last render-blocking
      // request disappears, so the shells paint on HTML arrival. The CSP
      // already allows 'unsafe-inline' for styles.
      const cssTag = base.match(/<link rel="stylesheet"[^>]*href="\/(assets\/[^"]+\.css)"[^>]*>/);
      if (cssTag) {
        let css = readFileSync(join(outDir, cssTag[1]), 'utf8');
        // Both latin text subsets ride INSIDE the CSS as data: URIs: hero and
        // lede paint once, in their final fonts, with no network race at all.
        // Anything else loses — painted in a fallback first, the text reflows
        // when the real font lands: the app's identical h1 then registered as
        // a new, later LCP candidate, and the lede's reflow scored CLS 0.063
        // (both measured). Costs ~90 KB per HTML; needs font-src data: in the
        // CSP. The mono font (code accents) keeps its swap — it shapes no
        // above-the-fold layout.
        // A data: font still decodes ASYNCHRONOUSLY: with swap, a throttled
        // first frame can beat the decode and paint the fallback (measured —
        // the lede reflowed 4→3 lines). block makes the text wait out the
        // few-ms decode instead: one paint, final font, and no network is
        // involved so the block period never actually shows.
        css = css.replace(
          /(@font-face\{[^}]*font-display:)swap([^}]*(?:bricolage-grotesque|public-sans)-latin-wght[^}]*\})/g,
          (_, head: string, tail: string) => `${head}block${tail}`,
        );
        for (const face of [
          ...css.matchAll(/\/assets\/(?:bricolage-grotesque|public-sans)-latin-wght[^)]+\.woff2/g),
        ]) {
          const woff2 = readFileSync(join(outDir, face[0].slice(1))).toString('base64');
          css = css.replace(face[0], () => `data:font/woff2;base64,${woff2}`);
        }
        // The shells reserve the header's exact footprint so the app's mount
        // shifts nothing; heights match the real header at both breakpoints.
        css += '#shell-header{height:105px}@media (min-width:640px){#shell-header{height:65px}}';
        base = base.replace(cssTag[0], () => `<style>${css}</style>`);
      }

      writeFileSync(
        htmlPath,
        base.replace('</head>', () => `${rootTargets.map(preload).join('')}  </head>`),
      );

      const en = JSON.parse(readFileSync('src/locales/en.json', 'utf8')) as Record<string, unknown>;
      const key = (path: string): string => {
        const value = path
          .split('.')
          .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], en);
        if (typeof value !== 'string') throw new Error(`shell key missing: ${path}`);
        return value;
      };
      const esc = (s: string) =>
        s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/'/g, '&#39;');

      // Cloudflare Pages serves exact files before the SPA fallback, so only
      // direct visits get this head start — measured LCP driver on /ml was
      // 87% render delay without it.
      for (const route of SHELL_ROUTES) {
        const title = route.highlight
          ? `${esc(key(`${route.prefix}.titlePre`))} <span class="bg-accent-soft box-decoration-clone px-1 text-accent-strong">${esc(key(`${route.prefix}.titleHighlight`))}</span>`
          : esc(key(`${route.prefix}.title`));
        const hero =
          `<div id="shell-header" class="border-b border-line"></div>` +
          `<div class="mx-auto max-w-6xl px-4"><section class="py-12 sm:py-16">` +
          `<p class="font-mono text-xs font-semibold tracking-[0.18em] text-copper uppercase">${esc(key(`${route.prefix}.eyebrow`))}</p>` +
          `<h1 class="mt-3 max-w-3xl font-display text-3xl font-bold text-balance sm:text-5xl">${title}</h1>` +
          `<p class="mt-5 max-w-2xl text-lg text-muted">${esc(key(`${route.prefix}.lede`))}</p></section></div>`;
        const shell = base
          .replace('</head>', () => `${preload(route.facade)}  </head>`)
          .replace('<div id="root"></div>', () => `<div id="root">${hero}</div>`);
        mkdirSync(join(outDir, route.dir), { recursive: true });
        writeFileSync(join(outDir, route.dir, 'index.html'), shell);
      }
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    prerenderShells(['features/home/HomePage', 'features/ml/pages/MlHomePage']),
    // ONNX Runtime's WASM binaries are self-hosted under /ort/ (strict CSP:
    // nothing may load from a CDN).
    viteStaticCopy({
      // Only the plain SIMD build: the jsep/jspi/asyncify variants weigh 15–27 MB
      // each and one of them exceeds Cloudflare Pages' 25 MB per-file limit.
      targets: [
        {
          src: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.{wasm,mjs}',
          dest: 'ort',
          rename: { stripBase: true },
        },
        // V27: transformers.js pins its OWN onnxruntime-web build, so the
        // local language model gets its runtime under /ort-llm/. The jsep
        // variant carries the WebGPU backend the model requires; the plain
        // and asyncify ones let the library fall back cleanly. All three are
        // under 25 MiB — the jsep build only by 0.1 MiB, so check on upgrades.
        {
          src: 'node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded{,.jsep,.asyncify}.{wasm,mjs}',
          dest: 'ort-llm',
          rename: { stripBase: true },
        },
        // V29: DuckDB-Wasm, self-hosted like everything else — the library
        // defaults to jsDelivr, which the CSP forbids. Two builds only: `eh`
        // (WebAssembly exception handling) and the `mvp` fallback. The `coi`
        // build is deliberately left out: it needs COOP/COEP headers and
        // SharedArrayBuffer, which LabML does not turn on.
        //
        // Version 1.28.0 is PINNED for a measured reason: from 1.29 the
        // binaries jumped past Cloudflare Pages' 25 MiB per-file limit
        // (eh 34.2 MiB, mvp 39.4 MiB) — at 1.28.0 they are 17.3 and 21.1 MiB
        // and fit with room to spare. Re-measure before any upgrade.
        {
          src: 'node_modules/@duckdb/duckdb-wasm/dist/duckdb-{eh,mvp}.wasm',
          dest: 'duckdb',
          rename: { stripBase: true },
        },
        {
          src: 'node_modules/@duckdb/duckdb-wasm/dist/duckdb-browser-{eh,mvp}.worker.js',
          dest: 'duckdb',
          rename: { stripBase: true },
        },
      ],
    }),
    // Offline-first PWA — the strongest proof that nothing needs a server.
    VitePWA({
      // 'prompt' + in-app registration: the update toast lets the user choose
      // when to reload, and no render-blocking registerSW.js is emitted.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'LabML — ML in your browser',
        short_name: 'LabML',
        description:
          'Train machine learning models on your own data, entirely in your browser. Nothing leaves your machine.',
        theme_color: '#0b6e5d',
        background_color: '#f4f7f6',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/pwa-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Demo datasets included: the lab trains fully offline.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,csv}'],
        // The vision model and ONNX runtime are cached on first use instead of
        // being precached — they would bloat the install for non-vision users.
        globIgnores: ['models/**', 'ort/**', 'ort-llm/**', 'llm/**', 'duckdb/**'],
        navigateFallback: '/index.html',
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /\/(models|ort)\//,
            handler: 'CacheFirst',
            options: { cacheName: 'labml-vision', expiration: { maxEntries: 12 } },
          },
          // V29: the SQL engine is 17–21 MiB depending on the browser. Cached
          // on first use like the vision models — never precached, so nobody
          // pays for it before opening the console, and offline afterwards.
          {
            urlPattern: /\/duckdb\//,
            handler: 'CacheFirst',
            options: { cacheName: 'labml-sql', expiration: { maxEntries: 6 } },
          },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        ...(process.env.V27_BENCH
          ? { bench: fileURLToPath(new URL('./bench-v27.html', import.meta.url)) }
          : {}),
      },
    },
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
